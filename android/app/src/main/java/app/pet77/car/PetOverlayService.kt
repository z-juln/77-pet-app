package app.pet77.car

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 桌宠悬浮窗服务。
 *
 * 结构刻意保持简单：
 *   - 画面窗：WebView 播宠物，窗口永远 FLAG_NOT_TOUCHABLE（视频 SurfaceView 会盖住同窗触摸层，
 *     点一下就会闪系统暂停键；所以画面窗绝不能收触摸）；
 *   - 命中窗：单独一块只盖身体的透明窗，负责点击/拖拽/长按；空白桌面自然点穿；
 *   - 长按/右键再开一个临时菜单窗口；
 *   - 不动态改窗口形状，不逐帧改窗口大小，只移动位置，避免车机整屏闪。
 */
class PetOverlayService : Service() {
    companion object {
        private const val TAG = "Pet77Car"
        private const val CHANNEL_ID = "pet77_car_running"
        private const val NOTIFICATION_ID = 7706
        const val ACTION_START = "app.pet77.car.action.START"
        const val ACTION_EXIT = "app.pet77.car.action.EXIT"
        const val ACTION_HOME = "app.pet77.car.action.HOME"
        const val ACTION_WHISPER = "app.pet77.car.action.WHISPER"
        private const val EDGE_GAP = 24f
        private const val LONG_PRESS_MS = 650L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val wm by lazy { getSystemService(WindowManager::class.java) }
    private lateinit var prefs: SharedPreferences

    private var visualRoot: FrameLayout? = null
    private var webView: WebView? = null
    private var visualParams: WindowManager.LayoutParams? = null
    /** 独立命中窗：盖住身体，避免 WebView 视频 Surface 抢走点击 */
    private var touchRoot: View? = null
    private var touchParams: WindowManager.LayoutParams? = null
    private var menu: PetMenuWindow? = null

    private var pets: List<PetMeta> = emptyList()
    private var currentConfig: PetConfig? = null
    private var currentPack: String = ""
    private var bootInjected = false
    private var pageLoaded = false
    private var stopping = false

    private var areaLeft = 0
    private var areaTop = 0
    private var screenW = 1920
    private var screenH = 1080
    private var effScale = 1f
    private var winW = BASE_WIN_W.roundToInt()
    private var winH = BASE_WIN_H.roundToInt()
    private var petX = 0f
    private var petY = 0f
    private var insets = ContentInsets(0.234f, 0.161f, 0.249f, 0.078f)

    private var downRawX = 0f
    private var downRawY = 0f
    private var dragging = false
    private var longFired = false
    private val touchSlop by lazy { ViewConfiguration.get(this).scaledTouchSlop }

    private val longPress = Runnable {
        if (!dragging) {
            longFired = true
            touchRoot?.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
            openMenu()
        }
    }

    private val savePositionLater = Runnable { savePositionNow() }

    private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key != null && !key.startsWith("pos")) {
            handler.post { applyPreferences() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        prefs = PetPrefs.get(this)
        prefs.registerOnSharedPreferenceChangeListener(prefsListener)
        createNotificationChannel()
        PetRuntime.isRunning = true
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_EXIT) {
            shutdown()
            return START_NOT_STICKY
        }
        if (!Settings.canDrawOverlays(this)) {
            toast("请先在系统设置里允许 77 Pet 显示在其他应用上层")
            stopSelf()
            return START_NOT_STICKY
        }
        ensureForeground()
        if (visualRoot == null) {
            showOverlay()
        } else {
            applyPreferences()
        }
        when (intent?.action) {
            ACTION_HOME -> goHome()
            ACTION_WHISPER -> runJs("window.petWhisperFallback && window.petWhisperFallback(true);")
        }
        return START_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (visualRoot == null) return
        // 与鸿蒙一致：系统旋转事件有时早于尺寸更新，短延迟再读屏并重定位
        handler.removeCallbacks(relayoutForScreen)
        handler.postDelayed(relayoutForScreen, 80)
    }

    /**
     * 横竖屏切换：按「宠物中心占可用区域比例」搬到新屏幕。
     * 手机默认大小按短边计算，旋转后窗口尺寸应基本不变；车机仍按宽换算。
     */
    private val relayoutForScreen = object : Runnable {
        private var retry = 0

        override fun run() {
            if (visualRoot == null) {
                retry = 0
                return
            }
            val oldScreenW = screenW
            val oldScreenH = screenH
            val centerRatioX = if (oldScreenW > 0) (petX + winW / 2f) / oldScreenW else 0.5f
            val centerRatioY = if (oldScreenH > 0) (petY + winH / 2f) / oldScreenH else 0.5f
            readScreenArea()
            if (screenW == oldScreenW && screenH == oldScreenH && retry < 6) {
                retry++
                handler.postDelayed(this, 80)
                return
            }
            retry = 0
            menu?.close()
            menu = null
            handler.removeCallbacks(longPress)
            dragging = false
            longFired = false
            val wantedScale = computeScale()
            val wantedW = (BASE_WIN_W * wantedScale).roundToInt()
            val wantedH = (BASE_WIN_H * wantedScale).roundToInt()
            effScale = wantedScale
            winW = wantedW
            winH = wantedH
            petX = centerRatioX.coerceIn(0f, 1f) * screenW - winW / 2f
            petY = centerRatioY.coerceIn(0f, 1f) * screenH - winH / 2f
            clampPosition()
            updateWindow()
            runJs(
                "window.petScreenChanged && window.petScreenChanged(" +
                    "$screenW,$screenH,$winW,$winH,${petX.roundToInt()},${petY.roundToInt()});",
            )
            scheduleSavePosition()
            Log.d(TAG, "screen rotated ${oldScreenW}x$oldScreenH -> ${screenW}x$screenH " +
                "pet=${petX.roundToInt()},${petY.roundToInt()} size=${winW}x$winH scale=$effScale")
        }
    }

    override fun onDestroy() {
        stopping = true
        handler.removeCallbacksAndMessages(null)
        menu?.close()
        menu = null
        val view = visualRoot
        visualRoot = null
        val touch = touchRoot
        touchRoot = null
        visualParams = null
        touchParams = null
        removeWindow(touch)
        removeWindow(view)
        webView?.destroy()
        webView = null
        prefs.unregisterOnSharedPreferenceChangeListener(prefsListener)
        PetRuntime.isRunning = false
        super.onDestroy()
    }

    // ---------- 启动与窗口 ----------

    private fun ensureForeground() {
        val open = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val exit = PendingIntent.getService(
            this,
            2,
            Intent(this, PetOverlayService::class.java).setAction(ACTION_EXIT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_pet)
            .setContentTitle(DeviceProfile.notificationTitle(this))
            .setContentText(getString(R.string.notification_body))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, getString(R.string.notification_exit), exit)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_body)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun showOverlay() {
        readScreenArea()
        pets = PetCatalog.loadPets(this)
        currentPack = PetPrefs.pack(this)
            .takeIf { id -> pets.any { it.id == id } }
            ?: PetCatalog.defaultPack(this, pets)
        effScale = computeScale()
        winW = (BASE_WIN_W * effScale).roundToInt()
        winH = (BASE_WIN_H * effScale).roundToInt()
        loadConfig(currentPack)
        restorePosition()

        val host = FrameLayout(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isFocusable = false
            isFocusableInTouchMode = false
            isClickable = false
        }
        val view = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = false
            isFocusable = false
            isLongClickable = false
            isHorizontalScrollBarEnabled = false
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            // 把视频合成进 View 树，降低 SurfaceView 单独成层的概率（主防靠画面窗 NOT_TOUCHABLE）
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            setOnTouchListener { _, _ -> true }
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                loadsImagesAutomatically = true
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = false
                cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
                if (Build.VERSION.SDK_INT >= 16) {
                    allowFileAccessFromFileURLs = true
                    allowUniversalAccessFromFileURLs = true
                }
            }
            addJavascriptInterface(PetJsBridge(), "petHost")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    pageLoaded = true
                    injectBootIfNeeded()
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage): Boolean {
                    Log.d(TAG, "web: ${consoleMessage.message()}")
                    return true
                }
            }
        }
        host.addView(
            view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        // 画面窗：永远不接收触摸，否则 WebView 视频 Surface 会弹出系统暂停键
        val visualLp = baseOverlayLp(
            winW,
            winH,
            areaLeft + petX.roundToInt(),
            areaTop + petY.roundToInt(),
            touchable = false,
        )
        val hit = bodyHitRect()
        val touch = View(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            isFocusable = false
            setOnTouchListener { _, event -> handleTouch(event) }
        }
        val touchLp = baseOverlayLp(
            hit.width().coerceAtLeast(1),
            hit.height().coerceAtLeast(1),
            areaLeft + petX.roundToInt() + hit.left,
            areaTop + petY.roundToInt() + hit.top,
            touchable = true,
        )

        try {
            wm.addView(host, visualLp)
            wm.addView(touch, touchLp)
        } catch (e: Exception) {
            Log.e(TAG, "add overlay failed", e)
            removeWindow(host)
            removeWindow(touch)
            toast("悬浮窗创建失败，请确认已允许“显示在其他应用上层”")
            stopSelf()
            return
        }
        visualRoot = host
        webView = view
        visualParams = visualLp
        touchRoot = touch
        touchParams = touchLp
        view.loadUrl("file:///android_asset/pet/index.html")
    }

    private fun baseOverlayLp(
        width: Int,
        height: Int,
        x: Int,
        y: Int,
        touchable: Boolean,
    ): WindowManager.LayoutParams {
        var flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        if (!touchable) {
            flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        }
        return WindowManager.LayoutParams(
            width,
            height,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            flags,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            this.x = x
            this.y = y
            alpha = 1f
        }
    }

    private fun updateWindow() {
        val view = visualRoot ?: return
        val lp = visualParams ?: return
        lp.width = winW
        lp.height = winH
        lp.x = areaLeft + petX.roundToInt()
        lp.y = areaTop + petY.roundToInt()
        lp.alpha = 1f
        // 保底：画面窗始终不可点
        lp.flags = lp.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        try {
            wm.updateViewLayout(view, lp)
        } catch (e: Exception) {
            Log.w(TAG, "update overlay failed", e)
        }
        updateTouchWindow()
    }

    private fun updateTouchWindow() {
        val touch = touchRoot ?: return
        val lp = touchParams ?: return
        val hit = bodyHitRect()
        lp.width = hit.width().coerceAtLeast(1)
        lp.height = hit.height().coerceAtLeast(1)
        lp.x = areaLeft + petX.roundToInt() + hit.left
        lp.y = areaTop + petY.roundToInt() + hit.top
        lp.flags = lp.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
        try {
            wm.updateViewLayout(touch, lp)
        } catch (e: Exception) {
            Log.w(TAG, "update touch overlay failed", e)
        }
    }

    private fun readScreenArea() {
        if (Build.VERSION.SDK_INT >= 30) {
            val metrics = wm.maximumWindowMetrics
            val bounds = metrics.bounds
            val bi = metrics.windowInsets.getInsets(
                WindowInsets.Type.systemBars() or
                    WindowInsets.Type.displayCutout() or
                    WindowInsets.Type.tappableElement() or
                    WindowInsets.Type.mandatorySystemGestures(),
            )
            areaLeft = bounds.left + bi.left
            areaTop = bounds.top + bi.top
            screenW = (bounds.width() - bi.left - bi.right).coerceAtLeast(320)
            screenH = (bounds.height() - bi.top - bi.bottom).coerceAtLeast(240)
        } else {
            val real = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(real)
            areaLeft = 0
            areaTop = 0
            screenW = real.widthPixels.coerceAtLeast(320)
            screenH = real.heightPixels.coerceAtLeast(240)
        }
    }

    private fun computeScale(): Float {
        // 屏幕基准对齐鸿蒙 petScreenScale；设置里的 scale 仍是相对值（1=默认）
        var value = DeviceProfile.petScreenScale(this) * PetPrefs.scale(this)
        value = min(value, 6f)
        // 可用高度兜底，避免竖屏气泡窗超出可见区
        value = min(value, screenH / BASE_WIN_H * 0.92f)
        return value.coerceAtLeast(0.35f)
    }

    private fun restorePosition() {
        val b = positionBounds()
        val rx = PetPrefs.posRatioX(this)
        val ry = PetPrefs.posRatioY(this)
        petX = if (rx < 0f) b.right else b.left + rx * (b.right - b.left)
        petY = if (ry < 0f) b.bottom else b.top + ry * (b.bottom - b.top)
        clampPosition()
    }

    private data class Bounds(val left: Float, val top: Float, val right: Float, val bottom: Float)

    private fun positionBounds(): Bounds {
        val maxX = (screenW - winW).coerceAtLeast(0)
        val maxY = (screenH - winH).coerceAtLeast(0)
        val gapX = min(EDGE_GAP, maxX.toFloat())
        val gapY = min(EDGE_GAP, maxY.toFloat())
        val padH = winH * (PAD_TOP / BASE_WIN_H)
        val videoH = winH - padH
        val leftPx = winW * insets.left
        val rightPx = winW * insets.right
        val topPx = videoH * insets.top
        val bottomPx = videoH * insets.bottom
        val minX = gapX - leftPx
        val maxContentX = screenW - winW - gapX + rightPx
        val minY = gapY - padH - topPx
        val maxContentY = screenH - winH - gapY + bottomPx
        return Bounds(
            left = minX,
            top = minY,
            right = maxOf(minX, maxContentX),
            bottom = maxOf(minY, maxContentY),
        )
    }

    private fun clampPosition() {
        val b = positionBounds()
        petX = petX.coerceIn(b.left, b.right)
        petY = petY.coerceIn(b.top, b.bottom)
    }

    // ---------- 网页配置 ----------

    private fun loadConfig(pack: String) {
        currentPack = pack
        val config = PetCatalog.loadConfig(this, pack)
        currentConfig = config
        insets = config.insets
    }

    private fun injectBootIfNeeded() {
        if (!pageLoaded || bootInjected) return
        val config = currentConfig ?: return
        val cfg = withRuntime(config.json)
        // 再剥一次 controls，防止 WebView 给 video 挂上系统暂停键
        runJs(
            "(function(){document.querySelectorAll('video').forEach(function(v){" +
                "v.controls=false;v.removeAttribute('controls');" +
                "v.setAttribute('controlslist','nodownload nofullscreen noremoteplayback');" +
                "});})();",
        )
        runJs("window.petBoot && window.petBoot($cfg);")
        runJs("window.petSettings && window.petSettings(${settingsJson()}, $effScale);")
        bootInjected = true
    }

    private fun withRuntime(base: JSONObject): JSONObject {
        val cfg = JSONObject(base.toString())
        cfg.put("stableMotion", PetPrefs.stableMotion(this))
        cfg.put("originX", petX.roundToInt())
        cfg.put("originY", petY.roundToInt())
        cfg.put("screenW", screenW)
        cfg.put("screenH", screenH)
        cfg.put("windowW", winW)
        cfg.put("windowH", winH)
        cfg.put(
            "contentInsets",
            JSONObject()
                .put("left", insets.left.toDouble())
                .put("top", insets.top.toDouble())
                .put("right", insets.right.toDouble())
                .put("bottom", insets.bottom.toDouble()),
        )
        return cfg
    }

    private fun settingsJson(): String = JSONObject()
        .put("opacity", PetPrefs.opacity(this).toDouble())
        .put("moveWeight", PetPrefs.moveWeight(this))
        .put("whisperOn", PetPrefs.whisperOn(this))
        .put("whisperSec", PetPrefs.whisperSec(this))
        .put("stableMotion", PetPrefs.stableMotion(this))
        .toString()

    private fun applyPreferences() {
        if (visualRoot == null) return
        val wantedPack = PetPrefs.pack(this)
            .takeIf { id -> pets.any { it.id == id } }
            ?: currentPack
        val packChanged = wantedPack != currentPack
        if (packChanged) {
            loadConfig(wantedPack)
            clampPosition()
            updateWindow()
        }

        val wantedScale = computeScale()
        val wantedW = (BASE_WIN_W * wantedScale).roundToInt()
        val wantedH = (BASE_WIN_H * wantedScale).roundToInt()
        if (wantedW != winW || wantedH != winH) {
            val centerX = petX + winW / 2f
            val bottomY = petY + winH
            effScale = wantedScale
            winW = wantedW
            winH = wantedH
            petX = centerX - winW / 2f
            petY = bottomY - winH
            clampPosition()
            updateWindow()
        }

        if (packChanged && pageLoaded) {
            bootInjected = true
            val cfg = withRuntime(currentConfig!!.json)
            runJs("window.petPackSwitch && window.petPackSwitch($cfg);")
        }
        if (pageLoaded) {
            runJs("window.petSettings && window.petSettings(${settingsJson()}, $effScale);")
            runJs("window.petScreenChanged && window.petScreenChanged($screenW,$screenH,$winW,$winH,${petX.roundToInt()},${petY.roundToInt()});")
        }
        scheduleSavePosition()
    }

    // ---------- 触摸 ----------

    /**
     * 宠物可见身体在悬浮窗内的矩形（窗口坐标）。
     * 窗口比身体大一圈（头顶气泡区 + 左右透明边），整窗接收触摸会感觉「点空也有反应」。
     */
    private fun bodyHitRect(): Rect {
        val padH = winH * (PAD_TOP / BASE_WIN_H)
        val videoH = (winH - padH).coerceAtLeast(1f)
        val expand = (10f * effScale).coerceIn(6f, 24f)
        val left = (winW * insets.left - expand).roundToInt().coerceAtLeast(0)
        val right = (winW - winW * insets.right + expand).roundToInt().coerceAtMost(winW)
        val top = (padH + videoH * insets.top - expand).roundToInt().coerceAtLeast(0)
        val bottom = (winH - videoH * insets.bottom + expand).roundToInt().coerceAtMost(winH)
        return Rect(left, top, right.coerceAtLeast(left + 1), bottom.coerceAtLeast(top + 1))
    }

    private fun isSecondaryButton(event: MotionEvent): Boolean {
        if (event.buttonState and MotionEvent.BUTTON_SECONDARY != 0) return true
        if (event.buttonState and MotionEvent.BUTTON_STYLUS_SECONDARY != 0) return true
        if (event.actionMasked == MotionEvent.ACTION_BUTTON_PRESS &&
            event.actionButton == MotionEvent.BUTTON_SECONDARY
        ) {
            return true
        }
        return false
    }

    private fun handleTouch(event: MotionEvent): Boolean {
        // 命中窗只盖身体；能进到这里的事件都算点在宠物上
        if (menu?.isShowing == true) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_BUTTON_PRESS -> {
                // 鼠标右键在部分机型只走 BUTTON_PRESS，不带 DOWN 的 SECONDARY
                if (isSecondaryButton(event)) {
                    openMenu()
                    return true
                }
                return true
            }
            MotionEvent.ACTION_DOWN -> {
                if (isSecondaryButton(event)) {
                    openMenu()
                    return true
                }
                downRawX = event.rawX
                downRawY = event.rawY
                dragging = false
                longFired = false
                handler.removeCallbacks(longPress)
                handler.postDelayed(longPress, LONG_PRESS_MS)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val distance = hypot((event.rawX - downRawX).toDouble(), (event.rawY - downRawY).toDouble())
                // 鼠标微抖很容易超过 touchSlop，把长按菜单取消掉；菜单优先于拖拽判定
                val dragThreshold = touchSlop * 2.5f
                if (!dragging && distance > dragThreshold) {
                    dragging = true
                    handler.removeCallbacks(longPress)
                    runJs(
                        "window.petApi && window.petApi.dragStart(" +
                            "${downRawX},${downRawY},${petX},${petY});",
                    )
                }
                if (dragging) {
                    runJs(
                        "window.petApi && window.petApi.dragMove(" +
                            "${event.rawX},${event.rawY});",
                    )
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                handler.removeCallbacks(longPress)
                if (dragging) {
                    dragging = false
                    runJs("window.petApi && window.petApi.dragEnd();")
                } else if (!longFired) {
                    // 飞行/漫游中点击：先把页面里的起点同步到窗口真实位置，
                    // 否则宠物停住后再走动会从旧起点跳回去。
                    runJs(
                        "window.petSyncPos && window.petSyncPos(" +
                            "${petX.roundToInt()},${petY.roundToInt()});" +
                            "window.petApi && window.petApi.click();",
                    )
                }
                longFired = false
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                handler.removeCallbacks(longPress)
                if (dragging) {
                    dragging = false
                    runJs("window.petApi && window.petApi.dragEnd();")
                }
                longFired = false
                return true
            }
        }
        return true
    }

    private fun openMenu() {
        if (menu?.isShowing == true) return
        handler.removeCallbacks(longPress)
        dragging = false
        runJs(
            "window.petSyncPos && window.petSyncPos(" +
                "${petX.roundToInt()},${petY.roundToInt()});" +
                "window.petPauseForMenu && window.petPauseForMenu();",
        )
        val area = Rect(areaLeft, areaTop, areaLeft + screenW, areaTop + screenH)
        val left = areaLeft + petX.roundToInt()
        val top = areaTop + petY.roundToInt()
        val right = left + winW
        val config = currentConfig ?: return
        val popup = PetMenuWindow(
            service = this,
            pets = pets,
            groups = config.groups,
            currentPack = currentPack,
            callbacks = object : PetMenuWindow.Callbacks {
                override fun onWhisper() {
                    runJs("window.petWhisperFallback && window.petWhisperFallback(true);")
                }

                override fun onPlay(anim: String) {
                    runJs("window.petApi && window.petApi.play(${JSONObject.quote(anim)});")
                }

                override fun onSwitchPack(id: String) {
                    PetPrefs.setPack(this@PetOverlayService, id)
                    applyPreferences()
                }

                override fun onHome() = goHome()
                override fun onSettings() = openSettings()
                override fun onAbout() = openAbout()
                override fun onQuit() = shutdown()
            },
        )
        menu = popup
        popup.show(left, top, right, area)
    }

    private fun openSettings() {
        try {
            startActivity(
                Intent(this, PetSettingsActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (e: Exception) {
            Log.w(TAG, "open settings failed", e)
        }
    }

    private fun openAbout() {
        try {
            startActivity(
                Intent(this, AboutActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (e: Exception) {
            Log.w(TAG, "open about failed", e)
        }
    }

    private fun goHome() {
        val b = positionBounds()
        petX = b.right
        petY = b.bottom
        updateWindow()
        runJs("window.petSyncPos && window.petSyncPos(${petX.roundToInt()},${petY.roundToInt()});")
        scheduleSavePosition()
    }

    // ---------- 与网页通信 ----------

    private fun runJs(code: String) {
        if (!pageLoaded) return
        val view = webView ?: return
        view.evaluateJavascript(code, null)
    }

    private fun moveFromPage(x: Float, y: Float) {
        petX = x
        petY = y
        clampPosition()
        updateWindow()
        scheduleSavePosition()
    }

    private fun scheduleSavePosition() {
        handler.removeCallbacks(savePositionLater)
        handler.postDelayed(savePositionLater, 700)
    }

    private fun savePositionNow() {
        val b = positionBounds()
        val rx = if (b.right - b.left > 1f) (petX - b.left) / (b.right - b.left) else 0f
        val ry = if (b.bottom - b.top > 1f) (petY - b.top) / (b.bottom - b.top) else 0f
        PetPrefs.savePosition(this, rx, ry)
    }

    private inner class PetJsBridge {
        @JavascriptInterface
        fun requestMove(x: Double, y: Double) {
            handler.post { moveFromPage(x.toFloat(), y.toFloat()) }
        }

        @JavascriptInterface
        fun requestWhisper(force: Boolean) {
            handler.post {
                if (force || PetPrefs.whisperOn(this@PetOverlayService)) {
                    runJs("window.petWhisperFallback && window.petWhisperFallback($force);")
                }
            }
        }

        @JavascriptInterface
        fun ready(count: Int) {
            handler.post {
                pageLoaded = true
                injectBootIfNeeded()
            }
        }

        @JavascriptInterface
        fun reportMotion(name: String) = Unit

        @JavascriptInterface
        fun reportBubble(x: Float, y: Float, w: Float, h: Float) = Unit

        @JavascriptInterface
        fun onEventEnd(name: String) = Unit

        @JavascriptInterface
        fun log(message: String) {
            Log.d(TAG, message)
        }
    }

    // ---------- 关闭 ----------

    private fun shutdown() {
        if (stopping) return
        stopping = true
        handler.removeCallbacksAndMessages(null)
        menu?.close()
        menu = null
        savePositionNow()
        val view = visualRoot
        visualRoot = null
        val touch = touchRoot
        touchRoot = null
        visualParams = null
        touchParams = null
        removeWindow(touch)
        removeWindow(view)
        webView?.destroy()
        webView = null
        pageLoaded = false
        bootInjected = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun removeWindow(view: View?) {
        if (view == null) return
        try {
            wm.removeViewImmediate(view)
        } catch (_: Exception) {
            // 系统已经回收时忽略
        }
    }
}
