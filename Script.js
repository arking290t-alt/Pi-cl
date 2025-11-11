const button = document.getElementById("generateBtn");
const statusDiv = document.getElementById("status");
const clipsDiv = document.getElementById("clipsContainer");

button.addEventListener("click", async () => {
  const url = document.getElementById("videoURL").value.trim();
  if (!url) {
    alert("Please enter a YouTube URL!");
    return;
  }

  statusDiv.innerText = "⏳ Processing video... This may take a few minutes.";
  clipsDiv.innerHTML = "";

  try {
    const res = await fetch("/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.error) {
      statusDiv.innerText = "❌ Error: " + data.error;
      return;
    }

    statusDiv.innerText = "✅ Done! Here are your highlight clips:";
    data.clips.forEach((clip) => {
      const vid = document.createElement("video");
      vid.src = clip;
      vid.controls = true;
      clipsDiv.appendChild(vid);
    });
  } catch (err) {
    statusDiv.innerText = "❌ Failed: " + err.message;
  }
});
