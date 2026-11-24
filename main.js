const drawCanvas = document.getElementById("drawCanvas");
const ctx = drawCanvas.getContext("2d", { willReadFrequently: true });
const onionCanvas = document.getElementById("onionCanvas");
const onionCtx = onionCanvas.getContext("2d");
const timelineStrip = document.getElementById("timelineStrip");

// Offscreen helper canvas used to scale full-size ImageData down to thumbnails
const helperCanvas = document.createElement("canvas");
helperCanvas.width = drawCanvas.width;
helperCanvas.height = drawCanvas.height;
const helperCtx = helperCanvas.getContext("2d");
const themeToggle = document.getElementById('themeBtn');

themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const icon = themeToggle.querySelector('i');
    icon.classList.toggle('fa-moon');
    icon.classList.toggle('fa-sun');

    if (document.body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark-mode');
    } else { 
        localStorage.removeItem('theme');
    }
});

if (localStorage.getItem('theme') === 'dark-mode') {
    document.body.classList.add('dark-mode');
    themeToggle.querySelector('i').classList.replace('fa-moon', 'fa-sun');
};

// App State
let frames = [ctx.createImageData(drawCanvas.width, drawCanvas.height)];
let currentFrame = 0;
let isDrawing = false;
let tool = "pen";
let onionEnabled = true;
let playTimer = null;
let points = [];

ctx.lineCap = "round";
ctx.lineJoin = "round";

// --- 1. Drawing Logic (Mouse, Touch & Stylus) ---
drawCanvas.addEventListener("pointerdown", (e) => {
  if (playTimer) return;
  if (tool === "select") return;

  isDrawing = true;
  drawCanvas.setPointerCapture(e.pointerId);

  const pt = getCoords(e);
  points = [pt, pt]; // Duplicate start point so dots/short taps still render

  // Configure brush once per stroke
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = document.getElementById("brushSize").value;

  if (tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = document.getElementById("colorPicker").value;
  }

  renderSmoothStroke();
});

drawCanvas.addEventListener("pointermove", (e) => {
  if (!isDrawing) return;
  if (tool === "select") return;

  // Use coalesced events if available for higher-precision stylus/mouse tracking
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const raw = getCoords(ev);
    const prev = points[points.length - 1];

    // Light input stabilization (0.55 = balanced smoothing, lower = stronger pull)
    const smoothFactor = 0.55;
    points.push({
      x: prev.x + (raw.x - prev.x) * smoothFactor,
      y: prev.y + (raw.y - prev.y) * smoothFactor
    });
  }

  renderSmoothStroke();
});

drawCanvas.addEventListener("pointerup", () => {
  if (!isDrawing) return;
  isDrawing = false;
  points = [];
  saveCurrentFrame();
  updateSingleThumbnail(currentFrame);
});

function renderSmoothStroke() {
  // Restore clean frame state so the stroke doesn't layer over itself
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  ctx.putImageData(frames[currentFrame], 0, 0);
  ctx.restore();

  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }

  // Connect to the final point
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function getCoords(e) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (drawCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (drawCanvas.height / rect.height)
  };
}

// --- 2. Frame Storage, Onion Skin & Visible Timeline ---
function saveCurrentFrame() {
  frames[currentFrame] = ctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
}

function renderTimeline() {
  timelineStrip.innerHTML = "";

  frames.forEach((frameData, index) => {
    const card = document.createElement("div");
    card.className = "frame-card" + (index === currentFrame ? " active" : "");
    card.dataset.index = index;

    const thumb = document.createElement("canvas");
    thumb.width = 104;
    thumb.height = 62;
    drawThumbImage(thumb, frameData);

    const badge = document.createElement("span");
    badge.className = "frame-number";
    badge.textContent = index + 1;

    card.appendChild(thumb);
    card.appendChild(badge);
    card.onclick = () => {
      if (playTimer) return;
      saveCurrentFrame();
      loadFrame(index);
    };

    timelineStrip.appendChild(card);
  });

  // Trailing "+" button to append a blank frame directly from the timeline
  const addCard = document.createElement("button");
  addCard.className = "add-card";
  addCard.title = "Add Blank Frame";
  addCard.textContent = "+";
  addCard.onclick = addBlankFrame;
  timelineStrip.appendChild(addCard);

  scrollToActiveFrame();
}

function updateSingleThumbnail(index) {
  const card = timelineStrip.querySelector(`.frame-card[data-index="${index}"]`);
  if (!card) return;
  const thumb = card.querySelector("canvas");
  drawThumbImage(thumb, frames[index]);
}

function drawThumbImage(thumbCanvas, imageData) {
  const tCtx = thumbCanvas.getContext("2d");
  helperCtx.putImageData(imageData, 0, 0);
  tCtx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
  tCtx.drawImage(helperCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
}

function scrollToActiveFrame() {
  const activeCard = timelineStrip.querySelector(".frame-card.active");
  if (activeCard) {
    activeCard.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
}

function loadFrame(index, rebuildStrip = false) {
  currentFrame = index;
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  ctx.putImageData(frames[currentFrame], 0, 0);

  onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
  if (onionEnabled && currentFrame > 0 && !playTimer) {
    onionCtx.putImageData(frames[currentFrame - 1], 0, 0);
  }

  document.getElementById("frameIndicator").textContent =
    `Frame ${currentFrame + 1} / ${frames.length}`;

  if (rebuildStrip) {
    renderTimeline();
  } else {
    timelineStrip.querySelectorAll(".frame-card").forEach((card, i) => {
      card.classList.toggle("active", i === currentFrame);
    });
    scrollToActiveFrame();
  }
}

// --- 3. Timeline & Tool Actions ---
function addBlankFrame() {
  if (playTimer) return;
  saveCurrentFrame();
  const blank = ctx.createImageData(drawCanvas.width, drawCanvas.height);
  frames.splice(currentFrame + 1, 0, blank);
  loadFrame(currentFrame + 1, true);
}

document.getElementById("penBtn").onclick = () => setTool("pen");
document.getElementById("eraserBtn").onclick = () => setTool("eraser");

function setTool(selected) {
  tool = selected;
  document.getElementById("penBtn").classList.toggle("active", tool === "pen");
  document.getElementById("eraserBtn").classList.toggle("active", tool === "eraser");
  document.getElementById("selectBtn").classList.toggle("active", tool === "select");
}

document.getElementById("onionBtn").onclick = (e) => {
  onionEnabled = !onionEnabled;
  e.target.textContent = `Onion Skin: ${onionEnabled ? "ON" : "OFF"}`;
  e.target.classList.toggle("active", onionEnabled);
  loadFrame(currentFrame);
};

document.getElementById("clearBtn").onclick = () => {
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  saveCurrentFrame();
  updateSingleThumbnail(currentFrame);
};

document.getElementById("prevBtn").onclick = () => {
  if (currentFrame > 0) { saveCurrentFrame(); loadFrame(currentFrame - 1); }
};

document.getElementById("nextBtn").onclick = () => {
  if (currentFrame < frames.length - 1) { saveCurrentFrame(); loadFrame(currentFrame + 1); }
};

document.getElementById("dupFrameBtn").onclick = () => {
  saveCurrentFrame();
  const copy = new ImageData(
    new Uint8ClampedArray(frames[currentFrame].data),
    drawCanvas.width, drawCanvas.height
  );
  frames.splice(currentFrame + 1, 0, copy);
  loadFrame(currentFrame + 1, true);
};

document.getElementById("delFrameBtn").onclick = () => {
  if (frames.length === 1) return;
  frames.splice(currentFrame, 1);
  loadFrame(Math.max(0, currentFrame - 1), true);
};

// --- 4. Playback Loop ---
document.getElementById("playBtn").onclick = (e) => {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    e.target.textContent = "Play";
    loadFrame(currentFrame);
  } else {
    saveCurrentFrame();
    onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
    e.target.textContent = "Stop";
    const fps = Math.max(1, Number(document.getElementById("fpsInput").value) || 12);
    playTimer = setInterval(() => {
      loadFrame((currentFrame + 1) % frames.length);
    }, 1000 / fps);
  }
};

// Initialize timeline on load
renderTimeline();

// --- 5. Brush Cursor Ring ---
const brushCursor = document.getElementById("brushCursor");
const brushSizeInput = document.getElementById("brushSize");

function updateBrushCursor(e) {
  if (playTimer) {
    brushCursor.hidden = true;
    return;
  }

  const rect = drawCanvas.getBoundingClientRect();
  const scale = rect.width / drawCanvas.width;
  const diameter = Math.max(2, Number(brushSizeInput.value) * scale);

  brushCursor.style.width = `${diameter}px`;
  brushCursor.style.height = `${diameter}px`;

  if (e) {
    brushCursor.style.left = `${e.clientX - rect.left}px`;
    brushCursor.style.top = `${e.clientY - rect.top}px`;
  }

  // Optional: tint the ring lightly to match the active brush or eraser
  brushCursor.style.backgroundColor =
    tool === "eraser" ? "rgba(255, 255, 255, 0.35)" : "transparent";

  brushCursor.hidden = false;
}

drawCanvas.addEventListener("pointerenter", updateBrushCursor);
drawCanvas.addEventListener("pointermove", updateBrushCursor);
drawCanvas.addEventListener("pointerleave", () => {
  brushCursor.hidden = true;
});

// Resize the ring immediately if you adjust the slider or use the scroll wheel
brushSizeInput.addEventListener("input", () => updateBrushCursor());
drawCanvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const step = e.deltaY < 0 ? 1 : -1;
  brushSizeInput.value = Math.min(30, Math.max(1, Number(brushSizeInput.value) + step));
  updateBrushCursor(e);
}, { passive: false });

// --- 6. Export Animation as WebM (with Save As Dialog) ---
document.getElementById("exportBtn").onclick = async (e) => {
  if (playTimer || frames.length === 0) return;
  saveCurrentFrame();

  // 1. Open the OS "Save As" dialog immediately on click
  let fileHandle = null;
  if ("showSaveFilePicker" in window) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: "animation.webm",
        types: [
          {
            description: "WebM Video",
            accept: { "video/webm": [".webm"] }
          }
        ]
      });
    } catch (err) {
      // User closed or cancelled the Save As dialog
      if (err.name === "AbortError") return;
      throw err;
    }
  }

  const btn = e.target;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Exporting...";

  const fps = Math.max(1, Number(document.getElementById("fpsInput").value) || 12);

  // Offscreen canvas with a solid white background
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = drawCanvas.width;
  exportCanvas.height = drawCanvas.height;
  const exportCtx = exportCanvas.getContext("2d");

  const stream = exportCanvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "video/webm" });

    if (fileHandle) {
      // 2. Write directly to the file location chosen in "Save As"
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      // Fallback for browsers without showSaveFilePicker (e.g., Firefox/Safari)
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "animation.webm";
      a.click();
      URL.revokeObjectURL(url);
    }

    btn.disabled = false;
    btn.textContent = originalText;
  };

  recorder.start();

  // Draw each frame in order at the chosen FPS
  for (let i = 0; i < frames.length; i++) {
    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    helperCtx.putImageData(frames[i], 0, 0);
    exportCtx.drawImage(helperCanvas, 0, 0);

    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
};

const selectionBox = document.getElementById('selectionBox');
const selectBtn = document.getElementById('selectBtn');

// Offscreen canvas to hold cut pixels with transparency intact
const floatCanvas = document.createElement('canvas');
const floatCtx = floatCanvas.getContext('2d');

// Remove currentTool; use 'tool' as the single source of truth
let selState = 'idle';   // 'idle' | 'selecting' | 'selected' | 'moving'
let selRect = { x: 0, y: 0, w: 0, h: 0 };
let dragStart = { x: 0, y: 0 };
let baseImageData = null; // Stores canvas state behind the floating selection

// Activate Select Tool
selectBtn.addEventListener('click', () => {
  commitSelection();
  setTool('select');
  document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
  selectBtn.classList.add('active');
  document.getElementById('brushCursor').hidden = true;
});

// Helper: stamp floating pixels permanently back onto drawCanvas
function commitSelection() {
  if (selState === 'selected' || selState === 'moving') {
    ctx.putImageData(baseImageData, 0, 0);
    ctx.drawImage(floatCanvas, selRect.x, selRect.y);
  }
  selState = 'idle';
  selectionBox.hidden = true;
  selectionBox.classList.remove('ready-to-move');
  baseImageData = null;
}

// Call commitSelection() whenever switching to pen/eraser or changing frames!
document.getElementById('penBtn').addEventListener('click', () => { commitSelection(); setTool('pen'); });
document.getElementById('eraserBtn').addEventListener('click', () => { commitSelection(); setTool('eraser'); });

function getCanvasCoords(e) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - rect.left) * (drawCanvas.width / rect.width)),
    y: Math.round((e.clientY - rect.top) * (drawCanvas.height / rect.height))
  };
}

function updateBoxUI() {
  const rect = drawCanvas.getBoundingClientRect();
  const scaleX = rect.width / drawCanvas.width;
  const scaleY = rect.height / drawCanvas.height;
  selectionBox.style.left = `${selRect.x * scaleX}px`;
  selectionBox.style.top = `${selRect.y * scaleY}px`;
  selectionBox.style.width = `${selRect.w * scaleX}px`;
  selectionBox.style.height = `${selRect.h * scaleY}px`;
}

drawCanvas.addEventListener('pointerdown', (e) => {
  if (tool !== 'select') return;
  const pos = getCanvasCoords(e);

  // 1. Check if clicking inside an existing selection to drag it
  if (
    selState === 'selected' &&
    pos.x >= selRect.x && pos.x <= selRect.x + selRect.w &&
    pos.y >= selRect.y && pos.y <= selRect.y + selRect.h
  ) {
    selState = 'moving';
    dragStart = { x: pos.x - selRect.x, y: pos.y - selRect.y };
    return;
  }

  // 2. Otherwise commit any previous selection and start a new marquee box
  commitSelection();
  selState = 'selecting';
  dragStart = pos;
  selRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
  updateBoxUI();
  selectionBox.hidden = false;
});

window.addEventListener('pointermove', (e) => {
  if (tool !== 'select') return;
  const pos = getCanvasCoords(e);

  if (selState === 'selecting') {
    selRect.x = Math.min(dragStart.x, pos.x);
    selRect.y = Math.min(dragStart.y, pos.y);
    selRect.w = Math.abs(pos.x - dragStart.x);
    selRect.h = Math.abs(pos.y - dragStart.y);
    updateBoxUI();
  } else if (selState === 'moving') {
    selRect.x = pos.x - dragStart.x;
    selRect.y = pos.y - dragStart.y;
    updateBoxUI();

    // Redraw background + floating selection at new position
    ctx.putImageData(baseImageData, 0, 0);
    ctx.drawImage(floatCanvas, selRect.x, selRect.y);
  }
});

window.addEventListener('pointerup', () => {
  if (tool !== 'select') return;

  if (selState === 'selecting') {
    // Ignore tiny accidental clicks
    if (selRect.w < 3 || selRect.h < 3) {
      commitSelection();
      return;
    }

    // Lift selected pixels onto floatCanvas
    floatCanvas.width = selRect.w;
    floatCanvas.height = selRect.h;
    const pickedPixels = ctx.getImageData(selRect.x, selRect.y, selRect.w, selRect.h);
    floatCtx.putImageData(pickedPixels, 0, 0);

    // Clear the original spot on drawCanvas and save the clean background
    ctx.clearRect(selRect.x, selRect.y, selRect.w, selRect.h);
    baseImageData = ctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);

    // Draw the lifted pixels right back in place so they remain visible
    ctx.drawImage(floatCanvas, selRect.x, selRect.y);

    selState = 'selected';
    selectionBox.classList.add('ready-to-move');
  } else if (selState === 'moving') {
    selState = 'selected';
  }
});

function commitSelection() {
  if (selState === "selected" || selState === "moving") {
    ctx.globalCompositeOperation = "source-over";
    ctx.putImageData(baseImageData, 0, 0);
    ctx.drawImage(floatCanvas, selRect.x, selRect.y);
    saveCurrentFrame();
    updateSingleThumbnail(currentFrame);
  }
  selState = "idle";
  selectionBox.hidden = true;
  selectionBox.classList.remove("ready-to-move");
  baseImageData = null;
}
