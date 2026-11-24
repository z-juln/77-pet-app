package app.pet77.car

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.util.DisplayMetrics
import android.view.WindowManager
import kotlin.math.max
import kotlin.math.min

/**
 * 同一 APK 内区分车机 / 手机。
 *
 * 保守策略：只有「明显是手机」才走手机文案与布局；其余（含识别不清的车机、
 * 平板）一律保持现有车机行为，避免误伤已上线的 BYD 车机版。
 */
enum class DeviceKind {
    CAR,
    PHONE,
}

object DeviceProfile {
    /**
     * 与鸿蒙 [petScreenScale] 一致：手机窄长屏若只按宽等比会显得过小，
     * 按短边再放大一档；且始终用短边，横竖屏切换时默认大小不变。
     */
    private const val PHONE_PET_BOOST = 2f

    fun kind(context: Context): DeviceKind {
        val app = context.applicationContext
        val pm = app.packageManager
        if (pm.hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE)) {
            return DeviceKind.CAR
        }
        val uiMode = app.getSystemService(UiModeManager::class.java)
        if (uiMode?.currentModeType == Configuration.UI_MODE_TYPE_CAR) {
            return DeviceKind.CAR
        }
        // 带通话能力且非车机 UI → 按手机适配
        if (pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) {
            return DeviceKind.PHONE
        }
        return DeviceKind.CAR
    }

    fun isPhone(context: Context): Boolean = kind(context) == DeviceKind.PHONE

    fun isCar(context: Context): Boolean = kind(context) == DeviceKind.CAR

    fun productSubtitle(context: Context): String =
        if (isPhone(context)) "安卓手机桌宠" else "BYD 车机桌宠"

    fun productEdition(context: Context): String =
        if (isPhone(context)) "安卓手机版" else "BYD 车机版"

    fun surfaceName(context: Context): String =
        if (isPhone(context)) "手机桌面" else "车机桌面"

    fun notificationTitle(context: Context): String =
        if (isPhone(context)) "77 Pet 正在你的手机上" else "77 Pet 正在你的车机上"

    /** 设置页内容最大阅读宽度：手机用窄一些，车机保持原宽。 */
    fun pageMaxWidthDp(context: Context): Int =
        if (isPhone(context)) 520 else 860

    /** 完整物理屏尺寸（缩放用）；与鸿蒙一致，不用「可用区域」以免横竖屏底栏差异改大小。 */
    fun fullScreenSize(context: Context): Pair<Int, Int> {
        val wm = context.getSystemService(WindowManager::class.java)
        if (wm != null) {
            val real = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(real)
            if (real.widthPixels > 0 && real.heightPixels > 0) {
                return real.widthPixels to real.heightPixels
            }
        }
        val dm = context.resources.displayMetrics
        return dm.widthPixels to dm.heightPixels
    }

    /**
     * 屏幕基准缩放（设置里 scale=1 时的默认大小），对齐鸿蒙 petScreenScale。
     * 车机：按屏宽；手机：按短边 × [PHONE_PET_BOOST]。
     */
    fun petScreenScale(context: Context): Float {
        val (screenW, screenH) = fullScreenSize(context)
        val baseWidth = if (isPhone(context)) {
            min(screenW, screenH).toFloat() * PHONE_PET_BOOST
        } else {
            max(screenW, 1).toFloat()
        }
        val scale = baseWidth * MAC_PET_W / MAC_SCREEN_W / STAGE_W
        return scale.coerceIn(0.5f, 6f)
    }
}
