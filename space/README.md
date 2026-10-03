---
title: OXY Video Free
emoji: 🎬
colorFrom: indigo
colorTo: blue
sdk: gradio
sdk_version: 5.42.0
app_file: app.py
pinned: false
short_description: Free ZeroGPU image-to-video router for game animation
---

# OXY Video Free

MCP-enabled Gradio gateway for short game animations.

Upstream engines:
- `zerogpu-aoti/wan2-2-fp8da-aoti-faster`
- `Lightricks/ltx-video-distilled`

The gateway itself uses CPU. Heavy generation is delegated to upstream Hugging Face Spaces.
