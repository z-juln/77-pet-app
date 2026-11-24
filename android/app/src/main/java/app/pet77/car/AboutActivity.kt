package app.pet77.car

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** 版本、更新检测、自动检查开关、素材与仓库来源说明。 */
class AboutActivity : AppCompatActivity() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var currentText: TextView
    private lateinit var latestText: TextView
    private lateinit var statusText: TextView
    private lateinit var checkBtn: android.widget.Button
    private lateinit var updateBtn: android.widget.Button
    private lateinit var autoOff: Switch
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        render(AppUpdate.snapshot(this))
    }

    private fun buildUi(): ViewGroup {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(26), dp(24), dp(26))
            setBackgroundColor(Color.parseColor("#F6F7FB"))
        }
        root.addView(text("关于 77 Pet", 26f, Color.parseColor("#1E2230"), bold = true))
        root.addView(text(
            "${DeviceProfile.productEdition(this)} · 桌宠",
            14f,
            Color.parseColor("#697086"),
        ).apply { setPadding(0, dp(4), 0, dp(16)) })

        val intro = card()
        intro.addView(text("动画和表情包素材禁止商用。", 15f, Color.parseColor("#3A4054")))
        intro.addView(linkRow("本应用由 juln 开发", AppUpdate.authorUrl()).apply {
            setPadding(0, dp(10), 0, 0)
        })
        intro.addView(linkRow("项目地址 github.com/z-juln/77-pet-app", AppUpdate.projectUrl()).apply {
            setPadding(0, dp(6), 0, 0)
        })
        root.addView(intro)

        val source = card().apply {
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.topMargin = dp(14)
            layoutParams = lp
        }
        source.addView(text("宠物素材来源", 16f, Color.parseColor("#1E2230"), bold = true))
        source.addView(text(
            "桌宠资源在 77-pet-packs。本包装入了当前默认模板；完整目录在 GitHub，不通时可改用 Gitee 镜像。",
            14f,
            Color.parseColor("#697086"),
        ).apply {
            setPadding(0, dp(6), 0, 0)
            setLineSpacing(dp(3).toFloat(), 1f)
        })
        source.addView(linkRow("GitHub（推荐）", AppUpdate.packsGithubUrl()).apply {
            setPadding(0, dp(10), 0, 0)
        })
        source.addView(linkRow("Gitee 镜像", AppUpdate.packsGiteeUrl()).apply {
            setPadding(0, dp(6), 0, 0)
        })
        source.addView(text(AppUpdate.GITEE_STALE_NOTE, 12f, Color.parseColor("#9AA0B4")).apply {
            setPadding(0, dp(8), 0, 0)
            setLineSpacing(dp(2).toFloat(), 1f)
        })
        root.addView(source)

        val update = card().apply {
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.topMargin = dp(14)
            layoutParams = lp
        }
        update.addView(text("版本与更新", 16f, Color.parseColor("#1E2230"), bold = true))
        currentText = text("", 14f, Color.parseColor("#3A4054")).apply {
            setPadding(0, dp(8), 0, 0)
        }
        update.addView(currentText)
        latestText = text("", 14f, Color.parseColor("#3A4054")).apply {
            setPadding(0, dp(4), 0, 0)
            visibility = ViewGroup.GONE
        }
        update.addView(latestText)
        update.addView(linkRow("查看更新日志", AppUpdate.changelogUrl()).apply {
            setPadding(0, dp(8), 0, 0)
        })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(12), 0, 0)
        }
        checkBtn = primaryButton("检查新版本") { checkUpdate() }
        actions.addView(checkBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        updateBtn = secondaryButton("更新") { installUpdate() }.apply { visibility = ViewGroup.GONE }
        val updateLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        updateLp.topMargin = dp(8)
        actions.addView(updateBtn, updateLp)
        update.addView(actions)

        statusText = text("", 13f, Color.parseColor("#697086")).apply {
            setPadding(0, dp(10), 0, 0)
            setLineSpacing(dp(2).toFloat(), 1f)
        }
        update.addView(statusText)

        val autoRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(12), 0, 0)
        }
        autoOff = Switch(this).apply {
            isChecked = !PetPrefs.autoCheckUpdate(this@AboutActivity)
            setOnCheckedChangeListener { _, checked ->
                PetPrefs.setAutoCheckUpdate(this@AboutActivity, !checked)
                statusText.text = if (checked) {
                    "已关闭自动检测。仍可手动检查。"
                } else {
                    "已开启自动检测。"
                }
            }
        }
        autoRow.addView(autoOff)
        autoRow.addView(text("关闭自动检测更新", 14f, Color.parseColor("#1E2230")).apply {
            setPadding(dp(10), 0, 0, 0)
        })
        update.addView(autoRow)
        update.addView(text(
            "关闭后不再自动检查。有新版本时点「更新」，会下载 APK 并调起系统安装。",
            12f,
            Color.parseColor("#9AA0B4"),
        ).apply {
            setPadding(0, dp(8), 0, 0)
            setLineSpacing(dp(2).toFloat(), 1f)
        })
        root.addView(update)

        root.addView(text("Made for 77 Pet", 12f, Color.parseColor("#9AA0B4")).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, 0)
        })
        return centeredPage(root, DeviceProfile.pageMaxWidthDp(this).coerceAtMost(760))
    }

    private fun linkRow(label: String, url: String): TextView =
        text(label, 14f, Color.parseColor("#2B63FF")).apply {
            setOnClickListener {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: Exception) {
                    statusText.text = "打不开链接"
                }
            }
        }

    private fun render(snap: AppUpdate.Snapshot) {
        currentText.text = "当前版本 ${snap.current}"
        if (snap.latest.isNotBlank()) {
            latestText.visibility = ViewGroup.VISIBLE
            latestText.text = "最新版本 ${snap.latest}"
        } else {
            latestText.visibility = ViewGroup.GONE
        }
        updateBtn.visibility = if (snap.hasUpdate) ViewGroup.VISIBLE else ViewGroup.GONE
        statusText.text = snap.message
        busy = snap.phase == "checking" || snap.phase == "downloading" || snap.phase == "installing"
        checkBtn.isEnabled = !busy
        updateBtn.isEnabled = !busy
        autoOff.isChecked = !snap.autoCheck
    }

    private fun checkUpdate() {
        if (busy) return
        busy = true
        checkBtn.isEnabled = false
        statusText.text = "正在检查…"
        AppUpdate.checkAsync(this) { snap ->
            mainHandler.post { render(snap) }
        }
    }

    private fun installUpdate() {
        if (busy) return
        if (!AppUpdate.canRequestInstall(this)) {
            statusText.text = "请先允许「安装未知应用」，然后再点更新。"
            try {
                startActivity(AppUpdate.installPermissionIntent(this))
            } catch (_: Exception) {
                statusText.text = "请到系统设置里允许本应用安装未知来源"
            }
            return
        }
        busy = true
        checkBtn.isEnabled = false
        updateBtn.isEnabled = false
        statusText.text = "正在下载…"
        AppUpdate.downloadAndInstallAsync(
            this,
            onProgress = { snap -> mainHandler.post { render(snap) } },
            onDone = { snap -> mainHandler.post { render(snap) } },
        )
    }
}
