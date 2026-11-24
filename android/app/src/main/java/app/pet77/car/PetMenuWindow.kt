package app.pet77.car

import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView

/**
 * 宠物右键/长按菜单。
 *
 * 车机上不做横向飞出的三级菜单：屏幕宽、操作距离远，层级越深越难点。
 * 这里改成“一列 + 进入下一级 + 返回”，动作分类和具体动画都能在一屏内点完。
 *
 * 菜单窗口是临时的全屏透明层：点菜单外、按返回键都会收起。
 */
class PetMenuWindow(
    private val service: PetOverlayService,
    private val pets: List<PetMeta>,
    private val groups: List<PetMenuGroup>,
    private val currentPack: String,
    private val callbacks: Callbacks,
) {
    interface Callbacks {
        fun onWhisper()
        fun onPlay(anim: String)
        fun onSwitchPack(id: String)
        fun onHome()
        fun onSettings()
        fun onAbout()
        fun onQuit()
    }

    private val wm = service.getSystemService(WindowManager::class.java)
    private var root: FrameLayout? = null
    private var params: WindowManager.LayoutParams? = null
    private var panel: LinearLayout? = null
    private var scroll: ScrollView? = null
    private var header: TextView? = null
    private lateinit var list: LinearLayout
    private var menuWidth = 0
    private var maxHeight = 0
    private var area = android.graphics.Rect()
    private var anchorLeft = 0
    private var anchorTop = 0
    private var anchorRight = 0

    val isShowing: Boolean get() = root != null

    fun show(anchorLeft: Int, anchorTop: Int, anchorRight: Int, area: android.graphics.Rect) {
        close()
        this.area = area
        this.anchorLeft = anchorLeft
        this.anchorTop = anchorTop
        this.anchorRight = anchorRight
        val preferred = if (DeviceProfile.isPhone(service)) service.dp(320) else service.dp(420)
        menuWidth = minOf(preferred, area.width() - service.dp(24))
        maxHeight = (area.height() * 0.78f).toInt()

        val host = FrameLayout(service).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            isFocusable = true
            isFocusableInTouchMode = true
            setOnClickListener { close() }
            setOnKeyListener { _, keyCode, event ->
                if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                    close()
                    true
                } else {
                    false
                }
            }
        }

        val box = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            background = service.rounded(Color.WHITE, 14f, Color.parseColor("#1F000000"), 1f)
            elevation = service.dp(14f).toFloat()
            setPadding(service.dp(8), service.dp(8), service.dp(8), service.dp(8))
            isClickable = true
            setOnClickListener { }
        }
        panel = box

        val currentName = pets.firstOrNull { it.id == currentPack }?.name
        val headerText = if (currentName.isNullOrBlank()) "77 Pet" else "77 Pet · $currentName"
        val header = service.text(headerText, 14f, Color.parseColor("#697086"), bold = true).apply {
            setPadding(service.dp(12), service.dp(4), service.dp(12), service.dp(8))
        }
        this.header = header
        box.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val scroll = ScrollView(service).apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        this.scroll = scroll
        list = LinearLayout(service).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        box.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        host.addView(box)
        root = host

        renderRoot()
        place(anchorLeft, anchorTop, anchorRight)

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 0
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
        }
        params = lp
        try {
            wm.addView(host, lp)
            host.requestFocus()
        } catch (_: Exception) {
            root = null
            panel = null
        }
    }

    private fun place(anchorLeft: Int, anchorTop: Int, anchorRight: Int) {
        val box = panel ?: return
        if (menuWidth <= 0) return
        val height = measurePanelHeight()
        var x = anchorRight + service.dp(8)
        if (x + menuWidth > area.right - service.dp(8)) {
            x = anchorLeft - menuWidth - service.dp(8)
        }
        x = x.coerceIn(area.left + service.dp(8), maxOf(area.left + service.dp(8), area.right - menuWidth - service.dp(8)))
        var y = anchorTop
        if (y + height > area.bottom - service.dp(8)) {
            y = area.bottom - height - service.dp(8)
        }
        y = y.coerceIn(area.top + service.dp(8), maxOf(area.top + service.dp(8), area.bottom - height - service.dp(8)))
        val lp = FrameLayout.LayoutParams(menuWidth, height).apply {
            leftMargin = x
            topMargin = y
        }
        box.layoutParams = lp
    }

    private fun renderRoot() {
        list.removeAllViews()
        addRow("碎碎念") { close(); callbacks.onWhisper() }
        addRow("动作", arrow = true) { renderGroups() }
        addRow("切换宠物", arrow = true) { renderPets() }
        addRow("回到初始位置") { close(); callbacks.onHome() }
        addGap()
        addRow("设置") { close(); callbacks.onSettings() }
        addRow("关于") { close(); callbacks.onAbout() }
        addGap()
        addRow("退出桌宠", danger = true) { close(); callbacks.onQuit() }
        relayout()
    }

    private fun renderGroups() {
        list.removeAllViews()
        addBack("动作")
        if (groups.isEmpty()) {
            addHint("这个宠物还没有配置动作")
        } else {
            for (group in groups) {
                addRow("${group.label}（${group.items.size}）", arrow = true) { renderLeaves(group) }
            }
        }
        relayout()
    }

    private fun renderLeaves(group: PetMenuGroup) {
        list.removeAllViews()
        addBack(group.label)
        for (leaf in group.items) {
            addRow(leaf.label) {
                close()
                callbacks.onPlay(leaf.anim)
            }
        }
        relayout()
    }

    private fun renderPets() {
        list.removeAllViews()
        addBack("切换宠物")
        if (pets.isEmpty()) {
            addHint("没有找到宠物包")
        } else {
            for (pet in pets) {
                val mark = if (pet.id == currentPack) "✓  " else "     "
                addRow(mark + pet.name) {
                    close()
                    callbacks.onSwitchPack(pet.id)
                }
            }
        }
        relayout()
    }

    private fun relayout() {
        if (panel == null || root == null || menuWidth <= 0) return
        place(anchorLeft, anchorTop, anchorRight)
    }

    /**
     * 先量内容再定面板高度：项目少时面板收紧，项目多时封顶并可滚动。
     * 不能给 ScrollView 用 weight——面板本身是 wrap_content，weight 会把内容量成 0。
     */
    private fun measurePanelHeight(): Int {
        val box = panel ?: return 0
        val header = header ?: return 0
        val scroll = scroll ?: return 0
        val innerWidth = (menuWidth - service.dp(16)).coerceAtLeast(service.dp(80))
        header.measure(
            View.MeasureSpec.makeMeasureSpec(innerWidth, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
        )
        list.measure(
            View.MeasureSpec.makeMeasureSpec(innerWidth, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
        )
        val headerHeight = header.measuredHeight
        val contentHeight = list.measuredHeight
        val padding = service.dp(16)
        val desired = headerHeight + contentHeight + padding
        val panelHeight = minOf(maxHeight, desired)
        val scrollHeight = (panelHeight - headerHeight - padding).coerceAtLeast(0)
        val old = scroll.layoutParams
        if (old == null || old.height != scrollHeight) {
            scroll.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                scrollHeight,
            )
        }
        box.layoutParams = FrameLayout.LayoutParams(menuWidth, panelHeight)
        return panelHeight
    }

    private fun addBack(title: String) {
        addRow("‹  $title", accent = true) { renderRoot() }
        addLine()
    }

    private fun addHint(text: String) {
        list.addView(
            service.text(text, 14f, Color.parseColor("#697086")).apply {
                setPadding(service.dp(12), service.dp(12), service.dp(12), service.dp(12))
            },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
    }

    private fun addRow(
        label: String,
        arrow: Boolean = false,
        accent: Boolean = false,
        danger: Boolean = false,
        onClick: () -> Unit,
    ) {
        val row = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = service.dp(52)
            setPadding(service.dp(12), service.dp(10), service.dp(12), service.dp(10))
            background = pressable()
            isClickable = true
            setOnClickListener { onClick() }
        }
        val color = when {
            danger -> Color.parseColor("#C62828")
            accent -> Color.parseColor("#2B63FF")
            else -> Color.parseColor("#1E2230")
        }
        row.addView(
            service.text(label, 17f, color),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        if (arrow) {
            row.addView(service.text("›", 22f, Color.parseColor("#9AA0B4")))
        }
        list.addView(
            row,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
    }

    private fun addGap() {
        list.addView(Space(service), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, service.dp(4)))
        addLine()
    }

    private fun addLine() {
        list.addView(
            View(service).apply { setBackgroundColor(Color.parseColor("#ECEFF5")) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, service.dp(1)).apply {
                topMargin = service.dp(4)
                bottomMargin = service.dp(4)
            },
        )
    }

    private fun pressable(): StateListDrawable = StateListDrawable().apply {
        addState(
            intArrayOf(android.R.attr.state_pressed),
            service.rounded(Color.parseColor("#EEF3FF"), 9f),
        )
        addState(intArrayOf(), service.rounded(Color.TRANSPARENT, 9f))
    }

    fun close() {
        val view = root ?: return
        root = null
        panel = null
        params = null
        try {
            wm.removeViewImmediate(view)
        } catch (_: Exception) {
            // 窗口已经跟着系统回收时不用再管
        }
    }
}
