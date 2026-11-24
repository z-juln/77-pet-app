package app.pet77.car

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var statusTitle: TextView
    private lateinit var statusBody: TextView
    private lateinit var primary: android.widget.Button
    private lateinit var permissionCard: LinearLayout
    private lateinit var root: LinearLayout
    private var pendingStart = false
    private var autoStarted = false

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        updateUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Settings.canDrawOverlays(this) && !PetRuntime.isRunning && !autoStarted) {
            autoStarted = true
            startPet()
        }
        // 默认自动检查更新（仅查版本，不打扰；关于页可关）
        if (PetPrefs.autoCheckUpdate(this)) {
            AppUpdate.checkAsync(this) { /* 缓存结果，关于页可直接展示 */ }
        }
    }

    override fun onResume() {
        super.onResume()
        if (pendingStart && Settings.canDrawOverlays(this)) {
            pendingStart = false
            startPet()
        }
        updateUi()
    }

    private fun buildUi(): ViewGroup {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(28), dp(24), dp(28))
            setBackgroundColor(Color.parseColor("#F6F7FB"))
        }
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val icon = android.widget.ImageView(this).apply {
            setImageResource(R.drawable.ic_launcher)
            scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
        }
        brand.addView(icon, LinearLayout.LayoutParams(dp(58), dp(58)))
        val titles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, 0, 0)
        }
        titles.addView(text("77 Pet", 26f, Color.parseColor("#1E2230"), bold = true))
        titles.addView(text(DeviceProfile.productSubtitle(this), 14f, Color.parseColor("#697086")))
        brand.addView(titles, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(brand, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val status = card().apply {
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.topMargin = dp(22)
            layoutParams = lp
        }
        statusTitle = text("正在检查…", 18f, Color.parseColor("#1E2230"), bold = true)
        statusBody = text("", 14f, Color.parseColor("#697086")).apply {
            setLineSpacing(dp(3).toFloat(), 1f)
            setPadding(0, dp(6), 0, 0)
        }
        status.addView(statusTitle)
        status.addView(statusBody)
        primary = primaryButton("启动桌宠") { togglePet() }
        val primaryLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50))
        primaryLp.topMargin = dp(16)
        status.addView(primary, primaryLp)
        val settings = secondaryButton("打开桌宠设置") { openSettings() }
        val settingsLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        settingsLp.topMargin = dp(8)
        status.addView(settings, settingsLp)
        val about = secondaryButton("关于") { openAbout() }
        val aboutLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        aboutLp.topMargin = dp(8)
        status.addView(about, aboutLp)
        val pinHome = secondaryButton("添加到主屏幕") { offerHomeShortcut(force = true) }
        val pinLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        pinLp.topMargin = dp(8)
        status.addView(pinHome, pinLp)
        root.addView(status)

        val surface = DeviceProfile.surfaceName(this)
        permissionCard = card().apply {
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.topMargin = dp(14)
            layoutParams = lp
            addView(text("还差一步", 17f, Color.parseColor("#1E2230"), bold = true))
            addView(text(
                "需要允许 77 Pet 显示在其他应用上层，桌宠才能出现在${surface}上。",
                14f,
                Color.parseColor("#697086"),
            ).apply { setPadding(0, dp(6), 0, dp(12)) })
            addView(primaryButton("去允许悬浮窗") { openOverlayPermission() })
        }
        root.addView(permissionCard)

        val tips = card().apply {
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.topMargin = dp(14)
            layoutParams = lp
        }
        tips.addView(text("怎么玩", 17f, Color.parseColor("#1E2230"), bold = true))
        val menuHint = if (DeviceProfile.isPhone(this)) {
            "菜单：长按宠物打开（手机一般没有鼠标右键）。\n"
        } else {
            "菜单：长按宠物，或用鼠标右键点宠物。\n"
        }
        tips.addView(text(
            "拖动：按住宠物移动，松手会按力度甩出去。\n" +
                menuHint +
                "菜单里有动作、切换宠物、设置、关于和退出。",
            14f,
            Color.parseColor("#697086"),
        ).apply {
            setLineSpacing(dp(4).toFloat(), 1f)
            setPadding(0, dp(8), 0, 0)
        })
        root.addView(tips)

        root.addView(text(
            "0.0.6 · ${DeviceProfile.productEdition(this)}",
            12f,
            Color.parseColor("#9AA0B4"),
        ).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(20), 0, 0)
        })
        return centeredPage(root, DeviceProfile.pageMaxWidthDp(this))
    }

    private fun updateUi() {
        val allowed = Settings.canDrawOverlays(this)
        val surface = DeviceProfile.surfaceName(this)
        permissionCard.visibility = if (allowed) ViewGroup.GONE else ViewGroup.VISIBLE
        if (!allowed) {
            statusTitle.text = "还差一个系统权限"
            statusBody.text = "允许悬浮窗后，桌宠就会出现在${surface}上。"
            primary.text = "去允许悬浮窗"
            return
        }
        if (PetRuntime.isRunning) {
            statusTitle.text = "桌宠正在运行"
            statusBody.text =
                "长按宠物能打开菜单。想再打开本页：从主屏幕的「77 Pet」图标，或上滑打开应用列表再点进来。"
            primary.text = "停止桌宠"
        } else {
            statusTitle.text = "桌宠没有运行"
            statusBody.text = "点下面的按钮把桌宠放到${surface}上。"
            primary.text = "启动桌宠"
        }
    }

    /**
     * 请求把图标钉到主屏幕。
     * 安卓安装后默认只进「应用列表」，不会自动出现在桌面；需系统弹窗确认。
     */
    private fun offerHomeShortcut(force: Boolean = false) {
        if (!force && PetPrefs.homeShortcutAsked(this)) return
        if (Build.VERSION.SDK_INT < 26) {
            if (force) statusBody.text = "当前系统不支持一键钉主屏，请从应用列表长按图标拖到桌面。"
            return
        }
        val sm = getSystemService(ShortcutManager::class.java) ?: return
        if (!sm.isRequestPinShortcutSupported) {
            if (force) statusBody.text = "这个桌面不支持钉图标，请打开应用列表找到「77 Pet」长按拖到主屏幕。"
            return
        }
        PetPrefs.setHomeShortcutAsked(this, true)
        val launch = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val shortcut = ShortcutInfo.Builder(this, "pet77_home")
            .setShortLabel(getString(R.string.app_name))
            .setLongLabel(getString(R.string.app_name))
            .setIcon(Icon.createWithResource(this, R.drawable.ic_launcher))
            .setIntent(launch)
            .build()
        try {
            sm.requestPinShortcut(shortcut, null)
            if (force) statusBody.text = "请在系统弹窗里确认「添加到主屏幕」。"
        } catch (_: Exception) {
            if (force) statusBody.text = "无法自动添加，请从应用列表找到「77 Pet」长按拖到主屏幕。"
        }
    }

    private fun togglePet() {
        if (!Settings.canDrawOverlays(this)) {
            pendingStart = true
            openOverlayPermission()
            return
        }
        if (PetRuntime.isRunning) stopPet() else startPet()
    }

    private fun startPet() {
        try {
            ContextCompat.startForegroundService(
                this,
                Intent(this, PetOverlayService::class.java).setAction(PetOverlayService.ACTION_START),
            )
            offerHomeShortcut()
            // 回到桌面看宠物；入口仍在应用列表 / 刚请求钉上的主屏图标
            root.postDelayed({ moveTaskToBack(true) }, 500)
        } catch (e: Exception) {
            statusBody.text = "启动失败：${e.message ?: "未知错误"}"
        }
        root.postDelayed({ updateUi() }, 400)
    }

    private fun stopPet() {
        startService(
            Intent(this, PetOverlayService::class.java).setAction(PetOverlayService.ACTION_EXIT),
        )
        root.postDelayed({ updateUi() }, 400)
    }

    private fun openSettings() {
        startActivity(Intent(this, PetSettingsActivity::class.java))
    }

    private fun openAbout() {
        startActivity(Intent(this, AboutActivity::class.java))
    }

    private fun openOverlayPermission() {
        try {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName"),
                ),
            )
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
        }
    }
}
