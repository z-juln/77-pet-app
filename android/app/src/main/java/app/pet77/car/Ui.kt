package app.pet77.car

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
fun Context.dp(value: Float): Int = (value * resources.displayMetrics.density).toInt()

fun Context.text(
    value: String,
    sizeSp: Float = 16f,
    color: Int = Color.parseColor("#1E2230"),
    bold: Boolean = false,
): TextView = TextView(this).apply {
    text = value
    setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, sizeSp)
    setTextColor(color)
    if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    includeFontPadding = false
}

fun Context.card(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    background = rounded(Color.WHITE, 16f, Color.parseColor("#12000000"), 1f)
    elevation = dp(1f).toFloat()
    setPadding(dp(18), dp(16), dp(18), dp(16))
}

fun Context.rounded(fill: Int, radiusDp: Float, stroke: Int = Color.TRANSPARENT, strokeDp: Float = 0f): GradientDrawable =
    GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(fill)
        cornerRadius = dp(radiusDp).toFloat()
        if (stroke != Color.TRANSPARENT && strokeDp > 0f) setStroke(dp(strokeDp), stroke)
    }

fun Context.primaryButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
    text = label
    isAllCaps = false
    setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 16f)
    setTextColor(Color.WHITE)
    backgroundTintList = ColorStateList.valueOf(Color.parseColor("#2B63FF"))
    stateListAnimator = null
    minHeight = dp(50)
    minimumHeight = dp(50)
    setPadding(dp(18), 0, dp(18), 0)
    setOnClickListener { onClick() }
}

fun Context.secondaryButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
    text = label
    isAllCaps = false
    setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 16f)
    setTextColor(Color.parseColor("#1E2230"))
    backgroundTintList = ColorStateList.valueOf(Color.parseColor("#E9EDF7"))
    stateListAnimator = null
    minHeight = dp(48)
    minimumHeight = dp(48)
    setPadding(dp(18), 0, dp(18), 0)
    setOnClickListener { onClick() }
}

fun Context.dangerButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
    text = label
    isAllCaps = false
    setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 16f)
    setTextColor(Color.parseColor("#B3261E"))
    backgroundTintList = ColorStateList.valueOf(Color.parseColor("#FDECEA"))
    stateListAnimator = null
    minHeight = dp(48)
    minimumHeight = dp(48)
    setPadding(dp(18), 0, dp(18), 0)
    setOnClickListener { onClick() }
}

fun Context.divider(): View = View(this).apply {
    setBackgroundColor(Color.parseColor("#ECEFF5"))
    layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(1),
    ).apply {
        topMargin = dp(12)
        bottomMargin = dp(12)
    }
}

/**
 * 车机屏很宽，设置页铺满整屏会显得空。把内容限制在一个居中的阅读宽度，
 * 既保留车机的大触控区，又不让每行文字拉成一条长线。
 */
fun Context.centeredPage(content: LinearLayout, maxWidthDp: Int = 860): ViewGroup {
    val scroll = ScrollView(this).apply {
        isFillViewport = true
        addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }
    val width = minOf(resources.displayMetrics.widthPixels - dp(32), dp(maxWidthDp))
    return FrameLayout(this).apply {
        setBackgroundColor(Color.parseColor("#F6F7FB"))
        addView(
            scroll,
            FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER_HORIZONTAL),
        )
    }
}

fun Context.row(title: String, subtitle: String? = null): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    setPadding(0, dp(10), 0, dp(10))
    addView(text(title, 16f, Color.parseColor("#1E2230")), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    if (subtitle != null) {
        addView(text(subtitle, 14f, Color.parseColor("#697086")), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ))
    }
}
