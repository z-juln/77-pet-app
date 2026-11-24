package app.pet77.car

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class PetSettingsActivity : AppCompatActivity() {
    private lateinit var root: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var permissionCard: LinearLayout
    private lateinit var packList: LinearLayout
    private var binding = false

    private var pack: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pack = PetPrefs.pack(this)
        setContentView(buildUi())
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun buildUi(): ViewGroup {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(28))
            setBackgroundColor(Color.parseColor("#F6F7FB"))
        }
        root.addView(text("桌宠设置", 26f, Color.parseColor("#1E2230"), bold = true))
        statusText = text("", 14f, Color.parseColor("#697086")).apply {
            setPadding(0, dp(6), 0, dp(0))
        }
        root.addView(statusText)

        permissionCard = card().apply {
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.topMargin = dp(16)
            layoutParams = lp
            addView(text("需要悬浮窗权限", 17f, Color.parseColor("#1E2230"), bold = true))
            addView(text("没有这个权限，桌宠无法离开应用显示在桌面上。", 14f, Color.parseColor("#697086")).apply {
                setPadding(0, dp(6), 0, dp(12))
            })
            addView(primaryButton("去允许") { openOverlayPermission() })
        }
        root.addView(permissionCard)

        val packHint = if (DeviceProfile.isPhone(this)) "选谁待在手机桌面上" else "选谁待在车机上"
        val packCard = titledCard("宠物", packHint)
        packList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        packCard.addView(packList)
        root.addView(packCard)
        renderPacks()

        val lookHint = if (DeviceProfile.isPhone(this)) {
            "调到不挡住聊天和按钮的程度"
        } else {
            "调到一个不挡开车视线的程度"
        }
        val lookCard = titledCard("大小与显示", lookHint)
        addSeek(
            lookCard,
            "宠物大小",
            max = 80,
            progress = (PetPrefs.scale(this) * 100 - 70).toInt(),
            formatter = { "宠物大小 ${it + 70}%" },
        ) { value ->
            PetPrefs.setScale(this, (value + 70) / 100f)
        }
        addSeek(
            lookCard,
            "透明度",
            max = 60,
            progress = (PetPrefs.opacity(this) * 100 - 40).toInt(),
            formatter = { "透明度 ${it + 40}%" },
        ) { value ->
            PetPrefs.setOpacity(this, (value + 40) / 100f)
        }
        root.addView(lookCard)

        val behaviorCard = titledCard("行为", "待机、转向、走动和碎碎念会自动来")
        addSwitch(
            behaviorCard,
            "自动碎碎念",
            "到点自己冒一句话，拖拽时不会打扰",
            PetPrefs.whisperOn(this),
        ) { on ->
            PetPrefs.setWhisperOn(this, on)
        }
        addSeek(
            behaviorCard,
            "碎碎念间隔",
            max = 570,
            progress = PetPrefs.whisperSec(this) - 30,
            formatter = { secondsText(it + 30) },
        ) { value ->
            PetPrefs.setWhisperSec(this, value + 30)
        }
        addSeek(
            behaviorCard,
            "自动走动频率",
            max = 20,
            progress = PetPrefs.moveWeight(this),
            formatter = { if (it == 0) "自动走动：关闭" else "自动走动：$it" },
        ) { value ->
            PetPrefs.setMoveWeight(this, value)
        }
        val stableHint = if (DeviceProfile.isPhone(this)) {
            "个别机型持续播放会闪屏时打开；不影响拖动和点击"
        } else {
            "个别车机持续播放会闪屏时打开；不影响拖动和点击"
        }
        addSwitch(
            behaviorCard,
            "稳定待机",
            stableHint,
            PetPrefs.stableMotion(this),
        ) { on ->
            PetPrefs.setStableMotion(this, on)
        }
        root.addView(behaviorCard)

        val actionCard = titledCard("桌宠", "不用退出应用也能操作")
        actionCard.addView(secondaryButton("回到初始位置") {
            serviceAction(PetOverlayService.ACTION_HOME)
        })
        val whisper = secondaryButton("现在碎碎念一句") {
            serviceAction(PetOverlayService.ACTION_WHISPER)
        }
        val whisperLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        whisperLp.topMargin = dp(8)
        actionCard.addView(whisper, whisperLp)
        val start = secondaryButton(if (PetRuntime.isRunning) "重新启动桌宠" else "启动桌宠") {
            startPet()
        }
        val startLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        startLp.topMargin = dp(8)
        actionCard.addView(start, startLp)
        val exit = dangerButton("退出桌宠") { stopPet() }
        val exitLp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        exitLp.topMargin = dp(8)
        actionCard.addView(exit, exitLp)
        root.addView(actionCard)

        root.addView(text(
            "0.0.6 · 77 Pet · ${DeviceProfile.productEdition(this)}",
            12f,
            Color.parseColor("#9AA0B4"),
        ).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(22), 0, 0)
        })

        return centeredPage(root, DeviceProfile.pageMaxWidthDp(this))
    }

    private fun titledCard(title: String, subtitle: String): LinearLayout {
        val card = card()
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(14)
        card.layoutParams = lp
        card.addView(text(title, 18f, Color.parseColor("#1E2230"), bold = true))
        card.addView(text(subtitle, 13f, Color.parseColor("#697086")).apply {
            setPadding(0, dp(4), 0, dp(10))
        })
        return card
    }

    private fun renderPacks() {
        packList.removeAllViews()
        val pets = PetCatalog.loadPets(this)
        if (pets.none { it.id == pack }) {
            pack = PetCatalog.defaultPack(this, pets)
            PetPrefs.setPack(this, pack)
        }
        for (pet in pets) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(50)
                setPadding(dp(10), dp(8), dp(10), dp(8))
                background = rounded(
                    if (pet.id == pack) Color.parseColor("#EEF3FF") else Color.TRANSPARENT,
                    10f,
                )
                isClickable = true
                setOnClickListener {
                    pack = pet.id
                    PetPrefs.setPack(this@PetSettingsActivity, pack)
                    renderPacks()
                }
            }
            row.addView(
                text(if (pet.id == pack) "✓" else " ", 18f, Color.parseColor("#2B63FF"), bold = true),
                LinearLayout.LayoutParams(dp(28), ViewGroup.LayoutParams.WRAP_CONTENT),
            )
            row.addView(
                text(pet.name, 16f, Color.parseColor("#1E2230")),
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
            )
            packList.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
    }

    private fun addSwitch(
        parent: LinearLayout,
        title: String,
        subtitle: String,
        checked: Boolean,
        onChange: (Boolean) -> Unit,
    ) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, dp(8))
        }
        val textBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textBox.addView(text(title, 16f, Color.parseColor("#1E2230")))
        textBox.addView(text(subtitle, 12f, Color.parseColor("#697086")).apply {
            setPadding(0, dp(3), dp(10), 0)
        })
        row.addView(textBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val toggle = Switch(this).apply {
            isChecked = checked
            setOnCheckedChangeListener { _, value ->
                if (!binding) onChange(value)
            }
        }
        row.addView(toggle)
        parent.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun addSeek(
        parent: LinearLayout,
        title: String,
        max: Int,
        progress: Int,
        formatter: (Int) -> String,
        onChange: (Int) -> Unit,
    ) {
        val label = text("", 15f, Color.parseColor("#1E2230"))
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(10), 0, dp(2))
        }
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        head.addView(text(title, 15f, Color.parseColor("#1E2230")), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        head.addView(label)
        wrap.addView(head)
        val bar = SeekBar(this).apply {
            this.max = max
            this.progress = progress.coerceIn(0, max)
        }
        label.text = formatter(bar.progress)
        bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, value: Int, fromUser: Boolean) {
                label.text = formatter(value)
                if (fromUser && !binding) onChange(value)
            }

            override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
        })
        wrap.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)))
        parent.addView(wrap)
    }

    private fun secondsText(seconds: Int): String {
        return if (seconds < 60) {
            "每 $seconds 秒"
        } else {
            val m = seconds / 60
            val s = seconds % 60
            if (s == 0) "每 $m 分钟" else "每 $m 分 $s 秒"
        }
    }

    private fun updateStatus() {
        statusText.text = if (PetRuntime.isRunning) "桌宠正在运行" else "桌宠没有运行"
        permissionCard.visibility = if (Settings.canDrawOverlays(this)) View.GONE else View.VISIBLE
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

    private fun serviceAction(action: String) {
        if (!PetRuntime.isRunning) {
            Toast.makeText(this, "桌宠还没有运行", Toast.LENGTH_SHORT).show()
            return
        }
        startService(Intent(this, PetOverlayService::class.java).setAction(action))
    }

    private fun startPet() {
        if (!Settings.canDrawOverlays(this)) {
            openOverlayPermission()
            return
        }
        ContextCompat.startForegroundService(
            this,
            Intent(this, PetOverlayService::class.java).setAction(PetOverlayService.ACTION_START),
        )
        root.postDelayed({ updateStatus() }, 400)
    }

    private fun stopPet() {
        startService(Intent(this, PetOverlayService::class.java).setAction(PetOverlayService.ACTION_EXIT))
        root.postDelayed({ updateStatus() }, 400)
    }
}
