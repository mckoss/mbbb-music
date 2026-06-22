<script lang="ts">
  // A dependency-free avatar cropper: pan (drag) and zoom (slider) the chosen
  // image within a fixed circular frame, then export the framed square as a
  // WebP blob. The frame IS the live preview, so what you see is what's saved.
  let {
    file,
    size = 512,
    onApply,
    onCancel,
  }: {
    file: File;
    size?: number;
    onApply: (blob: Blob) => void;
    onCancel: () => void;
  } = $props();

  const FRAME = 260; // on-screen crop frame (square), in px

  let url = $state('');
  let img = $state<HTMLImageElement | null>(null);
  let scale = $state(1);
  let minScale = $state(1);
  let tx = $state(0); // image→frame translation (px)
  let ty = $state(0);

  // Load the file into an Image and center it at the cover scale.
  $effect(() => {
    const objectUrl = URL.createObjectURL(file);
    url = objectUrl;
    const im = new Image();
    im.onload = () => {
      minScale = Math.max(FRAME / im.naturalWidth, FRAME / im.naturalHeight);
      scale = minScale;
      tx = (FRAME - im.naturalWidth * scale) / 2;
      ty = (FRAME - im.naturalHeight * scale) / 2;
      img = im;
    };
    im.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  });

  // Keep the frame fully covered by the image (no empty edges).
  function clamp() {
    if (!img) return;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    tx = Math.min(0, Math.max(FRAME - w, tx));
    ty = Math.min(0, Math.max(FRAME - h, ty));
  }

  let dragging = false;
  let lx = 0;
  let ly = 0;
  function down(e: PointerEvent) {
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    tx += e.clientX - lx;
    ty += e.clientY - ly;
    lx = e.clientX;
    ly = e.clientY;
    clamp();
  }
  function up() {
    dragging = false;
  }

  // Zoom around the frame center so the focal point stays put.
  function setScale(s: number) {
    if (!img) return;
    const cx = (FRAME / 2 - tx) / scale;
    const cy = (FRAME / 2 - ty) / scale;
    scale = s;
    tx = FRAME / 2 - cx * scale;
    ty = FRAME / 2 - cy * scale;
    clamp();
  }

  function apply() {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The frame region, expressed in source-image pixels.
    const sw = FRAME / scale;
    const sh = FRAME / scale;
    const sx = -tx / scale;
    const sy = -ty / scale;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    canvas.toBlob((b) => b && onApply(b), 'image/webp', 0.9);
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Crop your photo">
  <div class="dialog">
    <p class="title">Crop your photo</p>
    <p class="hint">Drag to reposition, slide to zoom.</p>

    <div
      class="frame"
      role="application"
      aria-label="Drag to reposition the photo within the circle"
      style="width:{FRAME}px;height:{FRAME}px"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      {#if img}
        <img
          class="src"
          src={url}
          alt=""
          draggable="false"
          style="width:{img.naturalWidth}px;height:{img.naturalHeight}px;transform:translate({tx}px,{ty}px) scale({scale});"
        />
      {/if}
      <div class="ring"></div>
    </div>

    <label class="zoom">
      <span>Zoom</span>
      <input
        type="range"
        min={minScale}
        max={minScale * 4}
        step="0.001"
        value={scale}
        oninput={(e) => setScale(+e.currentTarget.value)}
      />
    </label>

    <div class="actions">
      <button type="button" class="ghost" onclick={onCancel}>Cancel</button>
      <button type="button" class="apply" onclick={apply}>Use photo</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 50;
  }

  .dialog {
    background: var(--panel);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 20px;
    max-width: 320px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .title {
    font-weight: 800;
    font-size: 1rem;
  }

  .hint {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .frame {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    background: #efece3;
    touch-action: none;
    cursor: grab;
    user-select: none;
  }

  .src {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    max-width: none;
  }

  /* Darken the corners outside the circular crop. */
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    font-size: 0.82rem;
  }

  .zoom input {
    flex: 1;
  }

  .actions {
    display: flex;
    gap: 10px;
    width: 100%;
  }

  .actions button {
    flex: 1;
    min-height: 44px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .ghost {
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
  }

  .apply {
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
  }
</style>
