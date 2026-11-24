package app.pet77.car

import android.content.Context
import android.content.SharedPreferences

/**
 * 车机版设置的唯一存放处。
 *
 * 菜单、设置页、悬浮窗服务都读写同一份 SharedPreferences，避免出现
 * “设置页看起来改了，桌宠还是旧值”的两套状态。
 */
object PetPrefs {
    private const val STORE = "pet77_car"

    private const val KEY_PACK = "pack"
    private const val KEY_SCALE = "scale"
    private const val KEY_OPACITY = "opacity"
    private const val KEY_MOVE_WEIGHT = "moveWeight"
    private const val KEY_WHISPER_ON = "whisperOn"
    private const val KEY_WHISPER_SEC = "whisperSec"
    private const val KEY_STABLE_MOTION = "stableMotion"
    private const val KEY_POS_X = "posRatioX"
    private const val KEY_POS_Y = "posRatioY"
    private const val KEY_HOME_SHORTCUT_ASKED = "homeShortcutAsked"
    private const val KEY_AUTO_CHECK_UPDATE = "autoCheckUpdate"
    private const val KEY_UPDATE_SEEN_VERSION = "updateSeenVersion"

    fun get(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    fun pack(context: Context): String =
        get(context).getString(KEY_PACK, "blue-maid") ?: "blue-maid"

    fun setPack(context: Context, value: String) =
        get(context).edit().putString(KEY_PACK, value).apply()

    fun scale(context: Context): Float =
        get(context).getFloat(KEY_SCALE, 1f).coerceIn(0.7f, 1.5f)

    fun setScale(context: Context, value: Float) =
        get(context).edit().putFloat(KEY_SCALE, value.coerceIn(0.7f, 1.5f)).apply()

    fun opacity(context: Context): Float =
        get(context).getFloat(KEY_OPACITY, 1f).coerceIn(0.4f, 1f)

    fun setOpacity(context: Context, value: Float) =
        get(context).edit().putFloat(KEY_OPACITY, value.coerceIn(0.4f, 1f)).apply()

    fun moveWeight(context: Context): Int =
        get(context).getInt(KEY_MOVE_WEIGHT, 5).coerceIn(0, 20)

    fun setMoveWeight(context: Context, value: Int) =
        get(context).edit().putInt(KEY_MOVE_WEIGHT, value.coerceIn(0, 20)).apply()

    fun whisperOn(context: Context): Boolean =
        get(context).getBoolean(KEY_WHISPER_ON, true)

    fun setWhisperOn(context: Context, value: Boolean) =
        get(context).edit().putBoolean(KEY_WHISPER_ON, value).apply()

    fun whisperSec(context: Context): Int =
        get(context).getInt(KEY_WHISPER_SEC, 300).coerceIn(30, 3600)

    fun setWhisperSec(context: Context, value: Int) =
        get(context).edit().putInt(KEY_WHISPER_SEC, value.coerceIn(30, 3600)).apply()

    /**
     * 稳定待机：静止时停在当前帧，拖动与点击仍然播放。
     * 个别车机 GPU 会因持续合成透明视频出现整屏闪，这时可打开它。
     */
    fun stableMotion(context: Context): Boolean =
        get(context).getBoolean(KEY_STABLE_MOTION, false)

    fun setStableMotion(context: Context, value: Boolean) =
        get(context).edit().putBoolean(KEY_STABLE_MOTION, value).apply()

    /** -1 表示还没存过位置，首次启动用右下角。 */
    fun posRatioX(context: Context): Float = get(context).getFloat(KEY_POS_X, -1f)
    fun posRatioY(context: Context): Float = get(context).getFloat(KEY_POS_Y, -1f)

    fun homeShortcutAsked(context: Context): Boolean =
        get(context).getBoolean(KEY_HOME_SHORTCUT_ASKED, false)

    fun setHomeShortcutAsked(context: Context, value: Boolean) =
        get(context).edit().putBoolean(KEY_HOME_SHORTCUT_ASKED, value).apply()

    /** 默认开启自动检查更新 */
    fun autoCheckUpdate(context: Context): Boolean =
        get(context).getBoolean(KEY_AUTO_CHECK_UPDATE, true)

    fun setAutoCheckUpdate(context: Context, value: Boolean) =
        get(context).edit().putBoolean(KEY_AUTO_CHECK_UPDATE, value).apply()

    fun updateSeenVersion(context: Context): String =
        get(context).getString(KEY_UPDATE_SEEN_VERSION, "") ?: ""

    fun setUpdateSeenVersion(context: Context, value: String) =
        get(context).edit().putString(KEY_UPDATE_SEEN_VERSION, value).apply()

    fun savePosition(context: Context, x: Float, y: Float) {
        get(context).edit()
            .putFloat(KEY_POS_X, x.coerceIn(-1f, 2f))
            .putFloat(KEY_POS_Y, y.coerceIn(-1f, 2f))
            .apply()
    }
}
