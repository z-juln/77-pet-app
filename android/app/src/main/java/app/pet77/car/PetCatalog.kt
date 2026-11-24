package app.pet77.car

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** 宠物包在屏幕上的默认比例来自 macOS：462px 宠物画布配 1512px 屏。 */
const val MAC_PET_W = 462f
const val MAC_SCREEN_W = 1512f

/** 网页舞台原始尺寸，以及窗口左右各裁掉的透明边。 */
const val STAGE_W = 384f
const val BASE_WIN_W = 280f
const val BASE_WIN_H = 396f
const val CROP_LEFT = 52f
const val VIDEO_H = 216f
const val PAD_TOP = 180f

data class PetBounds(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
)

data class PetMeta(
    val id: String,
    val name: String,
    val bounds: PetBounds,
)

data class ContentInsets(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
)

data class PetLeaf(val label: String, val anim: String)
data class PetMenuGroup(val label: String, val items: List<PetLeaf>)

data class PetConfig(
    val pack: String,
    val json: JSONObject,
    val groups: List<PetMenuGroup>,
    val insets: ContentInsets,
)

object PetCatalog {
    private val fallbackBounds = PetBounds(0.30625f, 0.16111f, 0.68281f, 0.92222f)

    fun loadPets(context: Context): List<PetMeta> {
        val text = context.assets.open("pet/packs.json").bufferedReader().use { it.readText() }
        val root = JSONObject(text)
        val array = root.optJSONArray("pets") ?: JSONArray()
        val out = ArrayList<PetMeta>(array.length())
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val id = item.optString("id")
            if (id.isBlank()) continue
            val bounds = item.optJSONObject("bounds")?.let {
                PetBounds(
                    left = it.optDouble("left", fallbackBounds.left.toDouble()).toFloat(),
                    top = it.optDouble("top", fallbackBounds.top.toDouble()).toFloat(),
                    right = it.optDouble("right", fallbackBounds.right.toDouble()).toFloat(),
                    bottom = it.optDouble("bottom", fallbackBounds.bottom.toDouble()).toFloat(),
                )
            } ?: fallbackBounds
            out += PetMeta(id, item.optString("name", id), bounds)
        }
        if (out.isEmpty()) {
            out += PetMeta("blue-maid", "蓝毛小女仆", fallbackBounds)
        }
        return out
    }

    fun defaultPack(context: Context, pets: List<PetMeta>): String {
        val text = context.assets.open("pet/packs.json").bufferedReader().use { it.readText() }
        val id = JSONObject(text).optString("default")
        return pets.firstOrNull { it.id == id }?.id ?: pets.first().id
    }

    fun loadConfig(context: Context, pack: String): PetConfig {
        val meta = loadPets(context).firstOrNull { it.id == pack }
            ?: loadPets(context).first()
        val json = try {
            val text = context.assets
                .open("pet/packs/$pack/anim-config.json")
                .bufferedReader()
                .use { it.readText() }
            JSONObject(text)
        } catch (_: Exception) {
            JSONObject().put("pack", meta.id)
        }
        return PetConfig(
            pack = meta.id,
            json = json,
            groups = buildGroups(json),
            insets = contentInsets(meta.bounds),
        )
    }

    /**
     * 可见身体在窗口里的内缩比例。
     *
     * 舞台仍是 384 宽，但窗口只露出中间 280 宽，所以左右内缩要先减去裁边。
     */
    private fun contentInsets(bounds: PetBounds): ContentInsets {
        val bodyLeft = bounds.left * STAGE_W - CROP_LEFT
        val bodyRight = bounds.right * STAGE_W - CROP_LEFT
        return ContentInsets(
            left = (bodyLeft / BASE_WIN_W).coerceIn(0f, 0.45f),
            top = bounds.top.coerceIn(0f, 0.45f),
            right = ((BASE_WIN_W - bodyRight) / BASE_WIN_W).coerceIn(0f, 0.45f),
            bottom = (1f - bounds.bottom).coerceIn(0f, 0.45f),
        )
    }

    private fun buildGroups(json: JSONObject): List<PetMenuGroup> {
        val groups = ArrayList<PetMenuGroup>()
        addPool(groups, "待机", json.optJSONArray("idle"))
        addPool(groups, "转向", json.optJSONArray("turn"))
        addPool(groups, "拖拽", json.optJSONArray("drag"))
        addPool(groups, "点击回应", json.optJSONArray("clicks"))

        val moves = ArrayList<PetLeaf>()
        val moveArray = json.optJSONArray("moves")
        if (moveArray != null) {
            for (i in 0 until moveArray.length()) {
                val item = moveArray.optJSONObject(i) ?: continue
                val name = item.optString("name")
                if (name.isNotBlank()) moves += leaf(name)
            }
        }
        if (moves.isNotEmpty()) groups += PetMenuGroup("移动", moves)

        val categories = json.optJSONArray("categories")
        if (categories != null) {
            for (i in 0 until categories.length()) {
                val cat = categories.optJSONObject(i) ?: continue
                val label = cat.optString("id").ifBlank { "动作 ${i + 1}" }
                val leaves = ArrayList<PetLeaf>()
                val actions = cat.optJSONArray("actions")
                if (actions != null) {
                    for (j in 0 until actions.length()) {
                        val name = actions.optString(j)
                        if (name.isNotBlank()) leaves += leaf(name)
                    }
                }
                if (leaves.isNotEmpty()) groups += PetMenuGroup(label, leaves)
            }
        }

        val events = json.optJSONObject("events")
        if (events != null) {
            val labels = mapOf(
                "balance" to "余额档位",
                "whisper" to "碎碎念",
                "workStatus" to "工作状态",
            )
            for (key in events.keys()) {
                val leaves = ArrayList<PetLeaf>()
                flattenEvent(events.optJSONArray(key), leaves)
                if (leaves.isNotEmpty()) {
                    groups += PetMenuGroup(labels[key] ?: key, leaves)
                }
            }
        }
        return groups
    }

    private fun addPool(groups: ArrayList<PetMenuGroup>, label: String, array: JSONArray?) {
        if (array == null) return
        val leaves = ArrayList<PetLeaf>()
        for (i in 0 until array.length()) {
            val name = array.optString(i)
            if (name.isNotBlank()) leaves += leaf(name)
        }
        if (leaves.isNotEmpty()) groups += PetMenuGroup(label, leaves)
    }

    private fun flattenEvent(array: JSONArray?, out: MutableList<PetLeaf>) {
        if (array == null) return
        for (i in 0 until array.length()) {
            when (val item = array.opt(i)) {
                is String -> if (item.isNotBlank()) out += leaf(item)
                is JSONArray -> {
                    for (j in 0 until item.length()) {
                        val name = item.optString(j)
                        if (name.isNotBlank()) out += leaf(name)
                    }
                }
            }
        }
    }

    private fun leaf(file: String): PetLeaf = PetLeaf(file.removeSuffix(".webm"), file)
}
