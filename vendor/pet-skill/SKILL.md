---
name: dsh-pet-pack
description: 为 DSH Pet 桌面应用制作、导入并当场调试一种宠物。用户要做新桌宠、改动画、改表情包，或让桌面上的宠物马上看到改动时使用。
---

# 为 DSH Pet 做一种宠物

帮用户做一种能在桌面上跑起来的宠物，并按「改文件 → 桌面上立刻看到 → 再改」来调试。不要只交一份用户还得自己导入的压缩包。

这不是精灵图集宠物。一种宠物就是一个目录：配置、动画 webm、表情包 png 放在一起。

## 目录

把文件写到：

```text
{{PACK_DIR}}/<种类名>/
  config.jsonc
  webm/<动画名>.webm
  memes/<表情名>.png          可选
  whisper-fallbacks.json      可选
```

再在目录旁边写标记文件，内容只有 `import` 四个字母：

```text
{{PACK_DIR}}/<种类名>.origin
```

这样以后应用更新不会盖掉用户做的宠物。

种类名用用户起的名字。不要含 `/`、`\`。不要占用已经存在的种类，除非用户明确要替换它。源码运行时，仓库里的 `vendor/pets/<同名>` 优先于用户目录。内置种类不能删。用户导入或在本机新做的种类，可以在桌宠配置里点「删除种类」，资源目录和使用它的桌宠会一起去掉。

## 画面

每段动画是 **640×360** 的 webm，VP9 自带透明通道（`yuva420p`，`TAG:ALPHA_MODE=1`）。应用只播放文件里的透明通道，不会按颜色抠图。不要用 colorkey、绿幕或「把白底变透明」：角色身上的白边、高光会被抠穿。

源图必须本来就有透明背景。把带透明通道的 png 序列打成 webm：

```bash
ffmpeg -y -framerate 24 -i 帧%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -an 输出.webm
```

写完用 `ffprobe` 确认有 `TAG:ALPHA_MODE=1`。没有这个标记就不要拿去播放，重新从带透明通道的源导出。

人物默认朝左画。应用朝右时会把整段视频水平镜像。带文字的动作不要被镜像，在分类上写 `"noMirror": true`。

脚底落在画面 **y ≈ 330**。身体放在 **x 200–440、y 50–335** 里，点击和拖拽才打得中。窗口是 16:9，视频按 contain 铺进去。

待机要能循环。转向动画播完后，应用会自己把朝向翻到另一边。

动画名 = `webm/` 里的文件名，去掉 `.webm`，只写进 `animations`。表情名 = `memes/` 里的文件名，去掉 `.png`，只写进 `memes`。这是两套名字，不要互相借用。

## 最小配置

只有一段待机时，转向、拖拽、点击、走路先都指向同一段，避免点了没动画。权重先全部给待机。

```jsonc
{
  "whisperPrompt": "你是主人桌面上的一只宠物。说话短短一句，20字以内，说人话，不要解释你是AI。",
  "memes": {},
  "pets": [
    {
      "name": "种类名",
      "id": "main",
      "pack": "种类名",
      "size": 462,
      "balanceEnabled": false,
      "whisperEnabled": true,
      "workStatusEnabled": false,
      "fixedEnabled": true,
      "display": "desktop",
      "position": { "corner": "top-right", "marginX": 24, "marginY": 250 }
    }
  ],
  "animations": {
    "idle": ["待机"],
    "turn": ["待机"],
    "drag": ["待机"],
    "clicks": ["待机"],
    "moves": {
      "default": { "minDist": 60, "maxDist": 240, "margin": 20, "leadSec": 2, "tailSec": 2 },
      "actions": [{ "name": "待机" }]
    },
    "categories": [],
    "events": {
      "balance": [],
      "whisper": ["待机"],
      "workStatus": []
    }
  },
  "animationWeights": { "idle": 100, "turn": 0, "move": 0 }
}
```

有了更多片段再拆开：`turn` 用转身，`drag` 用被拎起来，`clicks` 用点一下的反应，`moves.actions` 用走路。随机小动作写在 `categories` 里，字段必须是 `id` 和 `actions`。写成 `name` 或 `animations` 时，播放会在初始化去读 `undefined.length` 并报错。`animationWeights` 的 idle、turn、move 与各分类的 `weight` 加起来等于 100。

```jsonc
"categories": [{ "id": "唱跳", "weight": 15, "actions": ["唱跳舞台"] }]
```

## 碎碎念的图和配文

气泡里的图只来自 `memes/<表情名>.png`。`config.jsonc` 的 `memes` 是「文件名 → 这张图在干什么」。键必须和 png 文件名一致，值是非空说明。文件不存在的键不会被使用。

`whisper-fallbacks.json` 只在有这些 png 时才写。它的键必须和 png 同名，每个键 10 句，每句不超过 20 个字。没有 png，就不要创建这个文件，`memes` 保持 `{}`。碎碎念可以只有一句话，没有图。

不要把动画名写进 `memes` 或 `whisper-fallbacks.json`。`唱跳舞台` 这种名字如果写进去，气泡会去找 `memes/唱跳舞台.png`，找不到就显示裂图。动画只放在 `webm/` 和 `animations` 里。

## 当场看效果

宿主地址是 `{{ORIGIN}}`。先请求 `GET {{ORIGIN}}/health`，确认返回里有 `"ok": true`。连不上就从 3080 到 3105 逐个试。

不要读取、不要打印 `~/.dsh-pet-app/settings.json`。那里有用户的 API Key。

1. 写好目录和 `.origin` 文件。
2. `GET {{ORIGIN}}/dsh-pet-7340/pet-config`，记下已有的 `pets`。保存时把它们原样带上，不要删掉用户现有的宠物。
3. 这种宠物还没出现在桌面上时，`PUT {{ORIGIN}}/dsh-pet-7340/pet-config`，请求头 `content-type: application/json`，正文是 `{ "pets": [ ...原来的全部, 新的一只 ] }`。新的一只要有不重复的 `id`、`name`、`pack`（等于种类名）、`size`（120–1200）、`position.corner`（`top-left`、`top-right`、`bottom-left`、`bottom-right` 之一）、`position.marginX`、`position.marginY`。保存成功后窗口会自己重开。
4. 只改了素材或 `config.jsonc` 时，`POST {{ORIGIN}}/dsh-pet-7340/reload`。同名 webm 换了内容也要 reload，否则窗口可能还播着旧的。
5. 看某一段：`POST {{ORIGIN}}/dsh-pet-7340/anim?pet=<实例id>`，正文 `{"name":"<动画名>"}`。`pet` 用宠物列表里的实例 `id`，不是种类名。

然后看用户桌面上的那只宠物。问清楚哪里不对（透明、脚的位置、点不中、循环接不上、朝向反了），改文件，再 reload，再点播同一段。先把待机看顺，再加下一段。

交给别人时才打 zip。zip 根目录就是 `config.jsonc`，也可以只包一层文件夹。用户在「桌宠配置 → 添加宠物 → 导入宠物包」里选择它。调试过程中不要反复打包。
