package app.pet77.car

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.regex.Pattern

/**
 * 查 GitHub Release、挑选安卓 APK、下载后调起系统安装。
 */
object AppUpdate {
    private const val TAG = "Pet77Update"
    const val UPDATE_REPO = "z-juln/77-pet-app"
    private const val RELEASES_LATEST_URL =
        "https://api.github.com/repos/$UPDATE_REPO/releases/latest"
    private const val WEB_LATEST_URL =
        "https://github.com/$UPDATE_REPO/releases/latest"
    private const val CHANGELOG_URL =
        "https://github.com/$UPDATE_REPO/blob/master/CHANGELOG.md"
    private const val PROJECT_URL = "https://github.com/$UPDATE_REPO"
    private const val AUTHOR_URL = "https://github.com/z-juln"
    private const val PACKS_GITHUB = "https://github.com/z-juln/77-pet-packs"
    private const val PACKS_GITEE = "https://gitee.com/juln/77-pet-packs"
    const val GITEE_STALE_NOTE = "Gitee 不一定是最新的，作者可能会忘记同步。"

    private val io = Executors.newSingleThreadExecutor()

    data class Asset(val name: String, val url: String)

    data class Release(
        val version: String,
        val assets: List<Asset>,
        val htmlUrl: String,
    )

    data class Snapshot(
        val current: String,
        val latest: String,
        val hasUpdate: Boolean,
        val autoCheck: Boolean,
        val phase: String,
        val message: String,
        val percent: Int,
        val htmlUrl: String,
        val assetName: String,
    )

    fun changelogUrl(): String = CHANGELOG_URL
    fun projectUrl(): String = PROJECT_URL
    fun authorUrl(): String = AUTHOR_URL
    fun packsGithubUrl(): String = PACKS_GITHUB
    fun packsGiteeUrl(): String = PACKS_GITEE

    fun currentVersion(context: Context): String {
        return try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            info.versionName ?: "0.0.0"
        } catch (_: Exception) {
            "0.0.0"
        }
    }

    fun compareVersions(left: String?, right: String?): Int {
        fun parse(value: String?): List<Int> =
            (value ?: "")
                .trim()
                .replace(Regex("^v", RegexOption.IGNORE_CASE), "")
                .split(Regex("[.+-]"))
                .map { part ->
                    Regex("^(\\d+)").find(part)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                }
        val a = parse(left)
        val b = parse(right)
        val length = maxOf(a.size, b.size)
        for (i in 0 until length) {
            val diff = (a.getOrElse(i) { 0 }) - (b.getOrElse(i) { 0 })
            if (diff != 0) return if (diff > 0) 1 else -1
        }
        return 0
    }

    fun pickAndroidAsset(assets: List<Asset>): Asset? {
        val apks = assets.filter { it.name.endsWith(".apk", ignoreCase = true) }
        return apks.firstOrNull { it.name.contains("byd-car", ignoreCase = true) }
            ?: apks.firstOrNull { it.name.contains("android", ignoreCase = true) }
            ?: apks.firstOrNull()
    }

    fun parseExpandedAssets(html: String): List<Asset> {
        val assets = ArrayList<Asset>()
        val seen = HashSet<String>()
        val pattern = Pattern.compile("""href="([^"]*/releases/download/[^"]+)"""")
        val matcher = pattern.matcher(html)
        while (matcher.find()) {
            var href = matcher.group(1) ?: continue
            val name = Uri.decode(href.substringAfterLast('/'))
            if (!name.endsWith(".apk", true) &&
                !name.endsWith(".dmg", true) &&
                !name.endsWith(".exe", true) &&
                !name.endsWith(".zip", true) &&
                !name.endsWith(".hap", true)
            ) {
                continue
            }
            if (!href.startsWith("http")) href = "https://github.com$href"
            if (!seen.add(href)) continue
            assets.add(Asset(name, href))
        }
        return assets
    }

    private fun versionFromTag(tag: String?): String =
        Uri.decode(tag ?: "").replace(Regex("^v", RegexOption.IGNORE_CASE), "")

    private fun openConnection(url: String): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("User-Agent", "77-pet-app-android")
        conn.instanceFollowRedirects = true
        return conn
    }

    fun fetchLatestRelease(): Release? {
        return try {
            fetchFromApi()
        } catch (apiError: Exception) {
            Log.w(TAG, "api release failed, try web", apiError)
            try {
                fetchFromWeb()
            } catch (webError: Exception) {
                Log.w(TAG, "web release failed", webError)
                throw apiError
            }
        }
    }

    private fun fetchFromApi(): Release? {
        val conn = openConnection(RELEASES_LATEST_URL)
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        conn.connect()
        val code = conn.responseCode
        if (code == 404) return null
        if (code == 403) throw IllegalStateException("检查更新过于频繁，请稍后再试")
        if (code !in 200..299) throw IllegalStateException("检查更新失败（$code）")
        val body = conn.inputStream.bufferedReader().use { it.readText() }
        val data = JSONObject(body)
        val version = versionFromTag(data.optString("tag_name"))
        if (version.isBlank()) return null
        val assetsJson = data.optJSONArray("assets")
        val assets = ArrayList<Asset>()
        if (assetsJson != null) {
            for (i in 0 until assetsJson.length()) {
                val item = assetsJson.optJSONObject(i) ?: continue
                val name = item.optString("name")
                val url = item.optString("browser_download_url")
                if (name.isNotBlank() && url.isNotBlank()) assets.add(Asset(name, url))
            }
        }
        val htmlUrl = data.optString("html_url").ifBlank {
            "https://github.com/$UPDATE_REPO/releases/latest"
        }
        return Release(version, assets, htmlUrl)
    }

    private fun fetchFromWeb(): Release? {
        val latest = openConnection(WEB_LATEST_URL)
        latest.instanceFollowRedirects = false
        latest.connect()
        val code = latest.responseCode
        if (code == 404) return null
        val location = latest.getHeaderField("Location") ?: ""
        val tagMatch = Regex("""/releases/tag/([^/?#]+)""").find(location)
            ?: throw IllegalStateException("检查更新失败（$code）")
        val version = versionFromTag(tagMatch.groupValues[1])
        val page = openConnection(
            "https://github.com/$UPDATE_REPO/releases/expanded_assets/${tagMatch.groupValues[1]}",
        )
        page.setRequestProperty("X-Requested-With", "XMLHttpRequest")
        page.connect()
        if (page.responseCode !in 200..299) {
            throw IllegalStateException("检查更新失败（${page.responseCode}）")
        }
        val html = page.inputStream.bufferedReader().use { it.readText() }
        return Release(
            version,
            parseExpandedAssets(html),
            "https://github.com/$UPDATE_REPO/releases/tag/$version",
        )
    }

    fun snapshot(
        context: Context,
        release: Release? = cachedRelease,
        phase: String = "idle",
        message: String = "",
        percent: Int = 0,
    ): Snapshot {
        val current = currentVersion(context)
        val latest = release?.version.orEmpty()
        val hasUpdate = release != null && compareVersions(latest, current) > 0
        val asset = if (hasUpdate) pickAndroidAsset(release!!.assets) else null
        return Snapshot(
            current = current,
            latest = latest,
            hasUpdate = hasUpdate,
            autoCheck = PetPrefs.autoCheckUpdate(context),
            phase = phase,
            message = message,
            percent = percent,
            htmlUrl = release?.htmlUrl.orEmpty(),
            assetName = asset?.name.orEmpty(),
        )
    }

    @Volatile
    private var cachedRelease: Release? = null

    fun cached(): Release? = cachedRelease

    fun checkAsync(context: Context, onDone: (Snapshot) -> Unit) {
        val app = context.applicationContext
        io.execute {
            val snap = try {
                val release = fetchLatestRelease()
                cachedRelease = release
                val base = snapshot(app, release, "idle")
                val message = when {
                    release == null -> "还没有发布版本"
                    base.hasUpdate -> "发现新版本 ${base.latest}"
                    else -> "已是最新版本"
                }
                if (base.hasUpdate) {
                    PetPrefs.setUpdateSeenVersion(app, base.latest)
                }
                base.copy(message = message)
            } catch (e: Exception) {
                val raw = e.message ?: "未知错误"
                val message = when {
                    raw.contains("timeout", true) || raw.contains("aborted", true) -> "检查更新超时"
                    raw.contains("过于频繁") -> raw
                    else -> "检查失败：$raw"
                }
                snapshot(app, cachedRelease, "error", message)
            }
            onDone(snap)
        }
    }

    fun downloadAndInstallAsync(
        context: Context,
        onProgress: (Snapshot) -> Unit,
        onDone: (Snapshot) -> Unit,
    ) {
        val app = context.applicationContext
        io.execute {
            val release = cachedRelease
            val asset = release?.let { pickAndroidAsset(it.assets) }
            if (release == null || asset == null || compareVersions(release.version, currentVersion(app)) <= 0) {
                onDone(snapshot(app, release, "error", "没有可安装的新版本"))
                return@execute
            }
            try {
                onProgress(snapshot(app, release, "downloading", "正在下载", 0))
                val dest = File(app.cacheDir, "pet77-update-" + asset.name.replace(Regex("[^\\w.\\-]+"), "_"))
                downloadToFile(asset.url, dest) { percent ->
                    onProgress(snapshot(app, release, "downloading", "正在下载 $percent%", percent))
                }
                onProgress(snapshot(app, release, "installing", "正在调起安装"))
                val ok = launchInstaller(app, dest)
                if (ok) {
                    onDone(snapshot(app, release, "done", "已调起系统安装，请在弹窗中确认"))
                } else {
                    onDone(snapshot(app, release, "error", "无法调起安装，请到设置允许安装未知应用"))
                }
            } catch (e: Exception) {
                val raw = e.message ?: "未知错误"
                val message = if (raw.contains("timeout", true)) "下载超时" else "更新失败：$raw"
                onDone(snapshot(app, release, "error", message))
            }
        }
    }

    private fun downloadToFile(url: String, dest: File, onPercent: (Int) -> Unit) {
        val conn = openConnection(url)
        conn.connect()
        if (conn.responseCode !in 200..299) {
            throw IllegalStateException("下载失败（${conn.responseCode}）")
        }
        val total = conn.contentLengthLong.coerceAtLeast(0L)
        conn.inputStream.use { input ->
            FileOutputStream(dest).use { output ->
                val buf = ByteArray(64 * 1024)
                var readTotal = 0L
                var lastPercent = -1
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    output.write(buf, 0, n)
                    readTotal += n
                    if (total > 0) {
                        val percent = ((readTotal * 100) / total).toInt().coerceIn(0, 100)
                        if (percent != lastPercent) {
                            lastPercent = percent
                            onPercent(percent)
                        }
                    }
                }
            }
        }
        onPercent(100)
    }

    fun launchInstaller(context: Context, apk: File): Boolean {
        return try {
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apk,
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "launch installer failed", e)
            false
        }
    }

    fun canRequestInstall(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= 26) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    fun installPermissionIntent(context: Context): Intent =
        Intent(
            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        )
}
