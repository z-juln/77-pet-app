---
name: dsh-pet-pack
description: 为 DSH Pet 桌面应用制作、导入并当场调试一种宠物。用户要做新桌宠、改动画、改表情包，或让桌面上的宠物马上看到改动时使用。
---

# 为 DSH Pet 做一种宠物

帮用户做一种能在桌面上跑起来的宠物，并按「改文件 → 桌面上立刻看到 → 再改」来调试。不要只交一份用户还得自己导入的压缩包。

这不是精灵图集，也没有「看向上下左右」的方向圈。一种宠物就是一个目录：配置、动画 webm、表情包 png 放在一起。不要做成一张多行小格的动画图。

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

安装后的应用只读 `~/.dsh-pet-app/pet-packs/<种类名>/`。`{{PACK_DIR}}` 就是这个路径。文件里如果还看得到花括号，说明读的是仓库里的源文件，不要自己猜目录。不要写到代理自己的任务目录，也不要写到仓库里的 `vendor/pet-packs/`。那里只放安装包用的 zip，应用运行时不读。源码运行时，仓库里的 `vendor/pets/<同名>` 优先于用户目录；用户没有要求改源码时，新宠物仍写到上面的用户目录。

种类名用用户起的名字。不要含 `/`、`\`。不要占用已经存在的种类，除非用户明确要替换它。内置种类不能删。用户导入或在本机新做的种类，可以在桌宠配置里点「删除种类」，资源目录和使用它的桌宠会一起去掉。

## 先定一只

用户给的角色图、旧动画、品牌名都可以当参考。没有名字时，按角色起一个短名字，当作种类名。

先确定主形象，后面每一段动画都对着它画。脸型、花纹、配色、材质、耳朵、发型、道具都要留着对照。各段之间这些不能变。

用户只给了品牌或产品名时，先弄清气质、配色和性格，再做成角色。不要把商标、可读文字、界面截图或口号画进动画。

一段动画不行，就整段重做。不要把另一次生成的单帧拼进已经通过的片段里。

宠物包目录里只留最终用到的 webm、png 和配置。生成用的草稿、联系表、提示词不要放进这个目录。

## 画面

每段动画是 **640×360** 的 webm，VP9 自带透明通道（`yuva420p`，`TAG:ALPHA_MODE=1`）。应用只播放文件里的透明通道，不会按颜色抠图。不要用 colorkey、绿幕或「把白底变透明」：角色身上的白边、高光会被抠穿。

能直接生成视频时，用视频模型出这一段动作，不要先画几张静帧再拼。视频模型出不了片时，才自己做透明 PNG 序列，再压成 webm。

无论哪条路，角色外侧都必须是真透明。生成结果经常是 RGB，或者带一块不透明底色、甚至把棋盘格画进画面。`convert("RGBA")` 不会去掉这块底。不要用 colorkey。用抠主体的模型把每一帧抠出来，推荐 `rembg`：

```bash
python3 -m pip install rembg pillow
python3 -c "from rembg import remove; from PIL import Image; im=Image.open('原图.png'); remove(im).save('透明.png')"
```

视频没有透明通道时，先拆成帧，逐帧 `rembg`，再按下一条命令压回去。抠完检查角色外侧：必须是透明像素，不能剩下一整块方形底。角色身上的白毛和高光要留着。画进画面里的棋盘格不是透明通道。

把带透明通道的 png 序列打成 webm：

```bash
ffmpeg -y -framerate 24 -i 帧%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -an 输出.webm
```

写完用 `ffprobe` 确认有 `TAG:ALPHA_MODE=1`。这时 `pix_fmt` 显示 `yuv420p` 是正常的，内置的蓝毛小女仆也是这样，不要把它当成没有透明通道，也不要为此反复重编码。透明通道要用 libvpx 解码再看：

```bash
ffmpeg -y -c:v libvpx-vp9 -i 输出.webm -vf alphaextract -frames:v 1 透明通道.png
```

这张图里，角色身体以外必须是黑的（透明）。身体周围如果是一块实心的方形，说明底色还在，先用 `rembg` 抠原图再导出。

人物默认朝左画。应用朝右时会把整段视频水平镜像。带文字的动作不要被镜像，在分类上写 `"noMirror": true`。

脚底落在画面 **y ≈ 330**。身体放在 **x 200–440、y 50–335** 里，点击和拖拽才打得中。窗口是 16:9，视频按 contain 铺进去。

应用在两段之间是直接切换，没有淡化或补间。连贯靠每一段自己的首尾姿势。

待机、走路这种会反复播的片段，首帧和尾帧必须是同一个姿势，接上时才不会跳。点击、拖拽、小动作从待机的姿势开始，结束时回到同一个姿势，这样切回待机不会闪。所有片段用同一个站立位置和同一个朝左的休息姿势，脚不要在片段之间挪地方。

转向动画播完后，应用会自己把朝向翻到另一边，所以这段的结尾要能接到另一侧，不要在片段内部自己翻面。待机要有轻微呼吸、眨眼或摇摆，不要整段完全不动。

一段动作里可以有道具，不限于宠物自己。吃饭、汉堡、落叶、玩具都可以入画，只要是这段动作的一部分：开始时还没有，或从休息姿势里拿出来，结束时回到没有这些道具的休息姿势。不要画文字、编号、标签、界面、网格、气泡或整块场景。不要加无关的漂浮星星、速度线、波纹、轨迹和光晕。身体要完整，不要裁掉，也不要留断开的碎片和杂点。角色颜色要在桌面上看得清。

动画名 = `webm/` 里的文件名，去掉 `.webm`，只写进 `animations`。表情名 = `memes/` 里的文件名，去掉 `.png`，只写进 `memes`。这是两套名字，不要互相借用。

## 先推荐，再问

不要只交一段待机。动手之前，按这只宠物的性格推荐一组，发给用户确认。用户说都可以，或没有删掉某一项，就按推荐做。用户明确只要待机时，才只做待机。

推荐里至少包括：

- 待机：呼吸，加上眨眼或轻微摇摆。
- 点击：被点到后的反应，写进 `clicks`。
- 拖拽：被拎起来，写进 `drag`。
- 碎碎念：`whisperEnabled` 保持开，写好 `whisperPrompt`。`events.whisper` 指向一段说话时的动作，不要永远指着待机。没有表情包也可以先只说话。
- 两三段性格小动作，写进 `categories`。可以带道具，例如吃饭、吃汉堡、被落叶埋一下。问用户还想要什么道具或动作。

转向和走路有余力再做。每做完一段就点播，不要等全部做完才给用户看。

## 动作怎么分配

有了对应片段，就填到这些字段，不要另起一套方向动画：

- `idle`：待机。轻微呼吸、眨眼或摇摆。
- `turn`：张望或转身。播完由应用翻面。
- `drag`：被拎起来。靠身体高度和姿态，不要落地的尘土。
- `clicks`：被点一下的反应。用肢体，不要画波纹或星星。
- `moves.actions`：走路。人物朝左，步调要看得出来。朝右不要另画一套，应用会镜像。花纹或道具镜像后会错的片段，不要拿来当走路。带文字的动作放到 `categories`，并写 `"noMirror": true`。
- `categories`：性格小动作。等待要和待机看得出差别。可以带吃饭、汉堡、落叶这类道具。

每做完一段，先按下面的检查看过，再点播到桌面上。待机顺了再做下一段。

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

声称已经挂上之前，先确认 `~/.dsh-pet-app/pet-packs/<种类名>/config.jsonc` 存在，并且 `GET {{ORIGIN}}/dsh-pet-7340/pet-config` 返回的种类列表里有它。没有的话，桌面上不会出现这只宠物。不要告诉用户去检查窗口是否被挡住。

然后看用户桌面上的那只宠物。问清楚哪里不对（透明、脚的位置、点不中、循环接不上、朝向反了），改文件，再 reload，再点播同一段。

下面任何一条都不要把这段交给用户：

- `ffprobe` 没有 `TAG:ALPHA_MODE=1`，背景不透明，或者白边、高光被抠穿。
- 身体被裁切，脚不在 y ≈ 330，或站在 x 200–440、y 50–335 外面，点不中。
- 这一段的脸、比例、配色、材质和主形象不一样。这段动作自己的道具可以出现，但结束时要收回。
- 待机接不上循环，两段动画交接时闪一下，或朝向反了。
- 动画名写进了 `memes` 或 `whisper-fallbacks.json`。
- `categories` 用了 `name`、`animations`，而不是 `id`、`weight`、`actions`。

交给别人时才打 zip。zip 根目录就是 `config.jsonc`，也可以只包一层文件夹。用户在「桌宠配置 → 添加宠物 → 导入宠物包」里选择它。调试过程中不要反复打包。
