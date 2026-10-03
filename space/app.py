import os

import gradio as gr
from PIL import Image
from gradio_client import Client, handle_file

WAN_SPACE = "zerogpu-aoti/wan2-2-fp8da-aoti-faster"
LTX_SPACE = "Lightricks/ltx-video-distilled"

DEFAULT_NEGATIVE = (
    "camera movement, camera rotation, zoom, pan, dolly, orbit, perspective change, "
    "character morphing, face change, distorted anatomy, extra arms, extra hands, extra fingers, "
    "duplicated weapon, warped sword, flicker, jitter, blurry details, background changes, "
    "text, subtitles, logo, watermark"
)

GAME_ATTACK_PROMPT = (
    "Preserve the source character exactly. Strict fixed top-down game camera. "
    "The character performs ONE fast powerful saber slash: a very short anticipation, "
    "one clean sweeping strike, a thin bright air-cut arc following the blade for only a few frames, "
    "then immediately returns to the original combat stance. "
    "Only the sword arm, shoulders, upper torso and hair may move naturally. "
    "The feet and character position stay locked in place. "
    "No camera movement, no zoom, no pan, no orbit, no perspective shift, no walking, "
    "no character displacement, no identity change, no costume change, no weapon change."
)

def _safe_image_path(image):
    if image is None:
        raise gr.Error("Загрузи исходную картинку.")
    if isinstance(image, (str, os.PathLike)):
        p = str(image)
        if not os.path.exists(p):
            raise gr.Error("Файл изображения не найден.")
        return p
    if isinstance(image, dict):
        for key in ("path", "name"):
            if image.get(key) and os.path.exists(str(image[key])):
                return str(image[key])
    raise gr.Error("Не удалось прочитать исходную картинку.")

def _ltx_dims(image_path):
    with Image.open(image_path) as im:
        w, h = im.size
    if w <= 0 or h <= 0:
        return 512, 512
    fixed = 768
    if w >= h:
        nh = fixed
        nw = round((fixed * w / h) / 32) * 32
    else:
        nw = fixed
        nh = round((fixed * h / w) / 32) * 32
    return max(256, min(1280, int(nw))), max(256, min(1280, int(nh)))

def _wan_generate(image_path, prompt, negative_prompt, duration, steps, seed, randomize):
    client = Client(WAN_SPACE, verbose=False)
    result = client.predict(
        handle_file(image_path),
        prompt,
        int(steps),
        negative_prompt,
        float(max(0.5, min(5.0, duration))),
        1.0,
        1.0,
        int(seed),
        bool(randomize),
        api_name="/generate_video",
    )
    if isinstance(result, (tuple, list)):
        video = result[0]
        used_seed = result[1] if len(result) > 1 else seed
    else:
        video, used_seed = result, seed
    return str(video), int(used_seed)

def _ltx_generate(image_path, prompt, negative_prompt, duration, seed, randomize):
    client = Client(LTX_SPACE, verbose=False)
    width, height = _ltx_dims(image_path)
    result = client.predict(
        prompt,
        negative_prompt,
        handle_file(image_path),
        None,
        int(height),
        int(width),
        "image-to-video",
        float(max(0.3, min(8.5, duration))),
        9,
        int(seed),
        bool(randomize),
        1.0,
        False,
        api_name="/image_to_video",
    )
    if isinstance(result, (tuple, list)):
        video = result[0]
        used_seed = result[1] if len(result) > 1 else seed
    else:
        video, used_seed = result, seed
    return str(video), int(used_seed)

def generate_video_free(
    image,
    prompt,
    engine,
    duration_seconds,
    negative_prompt,
    seed,
    randomize_seed,
    steps,
):
    image_path = _safe_image_path(image)
    prompt = (prompt or GAME_ATTACK_PROMPT).strip()
    negative_prompt = (negative_prompt or DEFAULT_NEGATIVE).strip()
    engine = engine or "Auto (Wan → LTX)"

    order = ["Wan2.2 14B Fast", "LTX Video Distilled"] if engine.startswith("Auto") else [engine]
    attempts = []

    for chosen in order:
        try:
            if chosen.startswith("Wan"):
                video, used_seed = _wan_generate(
                    image_path, prompt, negative_prompt,
                    duration_seconds, steps, seed, randomize_seed
                )
            else:
                video, used_seed = _ltx_generate(
                    image_path, prompt, negative_prompt,
                    duration_seconds, seed, randomize_seed
                )
            if not video:
                raise RuntimeError("Модель не вернула видеофайл.")
            return video, (
                f"Готово · движок: {chosen} · seed: {used_seed} · "
                f"длительность: {duration_seconds:.1f} сек."
            )
        except Exception as exc:
            attempts.append(f"{chosen}: {type(exc).__name__}: {exc}")
            if len(order) == 1:
                break

    raise gr.Error(
        "Бесплатные модели сейчас не смогли завершить генерацию. "
        "ZeroGPU может быть занят очередью или Space временно обновляется.\n\n"
        + "\n".join(attempts)
    )

def preset_attack():
    return GAME_ATTACK_PROMPT, DEFAULT_NEGATIVE, 1.0, 6

def preset_idle():
    prompt = (
        "Preserve the source character exactly. Strict fixed top-down game camera. "
        "Very subtle idle animation only: gentle breathing, tiny natural hair movement, "
        "weapon stays steady, feet stay locked, character position stays fixed. "
        "No camera movement, no zoom, no perspective change."
    )
    return prompt, DEFAULT_NEGATIVE, 1.5, 4

with gr.Blocks(title="OXY Video Free") as demo:
    gr.Markdown(
        "# OXY Video Free\n"
        "Бесплатный image-to-video шлюз для игровых анимаций через Hugging Face ZeroGPU."
    )

    with gr.Row():
        with gr.Column():
            image = gr.Image(type="filepath", label="Исходное изображение")
            prompt = gr.Textbox(label="Движение", value=GAME_ATTACK_PROMPT, lines=8)
            engine = gr.Dropdown(
                ["Auto (Wan → LTX)", "Wan2.2 14B Fast", "LTX Video Distilled"],
                value="Auto (Wan → LTX)",
                label="Движок",
            )
            duration = gr.Slider(0.5, 5.0, value=1.0, step=0.1, label="Длительность, сек.")
            with gr.Accordion("Дополнительно", open=False):
                negative = gr.Textbox(
                    label="Negative prompt",
                    value=DEFAULT_NEGATIVE,
                    lines=5,
                )
                seed = gr.Number(value=42, precision=0, label="Seed")
                randomize = gr.Checkbox(value=True, label="Случайный seed")
                steps = gr.Slider(4, 8, value=6, step=1, label="Wan steps")

            with gr.Row():
                attack_btn = gr.Button("Пресет: удар саблей")
                idle_btn = gr.Button("Пресет: idle")
            generate_btn = gr.Button("Сгенерировать видео", variant="primary")

        with gr.Column():
            output_video = gr.Video(label="Результат")
            status = gr.Textbox(label="Статус", interactive=False)

    attack_btn.click(
        fn=preset_attack,
        inputs=[],
        outputs=[prompt, negative, duration, steps],
        api_name="preset_attack",
    )
    idle_btn.click(
        fn=preset_idle,
        inputs=[],
        outputs=[prompt, negative, duration, steps],
        api_name="preset_idle",
    )
    generate_btn.click(
        fn=generate_video_free,
        inputs=[image, prompt, engine, duration, negative, seed, randomize, steps],
        outputs=[output_video, status],
        api_name="generate_video_free",
    )

if __name__ == "__main__":
    demo.queue(default_concurrency_limit=2).launch(mcp_server=True)
