from flask import Flask, render_template, request, jsonify
import os, subprocess, json
import yt_dlp
import whisper
from moviepy.video.io.ffmpeg_tools import ffmpeg_extract_subclip

app = Flask(__name__)
OUTPUT_DIR = "static/clips"
os.makedirs(OUTPUT_DIR, exist_ok=True)

model = whisper.load_model("small")  # change to 'base' or 'medium' if needed

def download_video(url):
    ydl_opts = {'outtmpl': 'video.%(ext)s', 'format': 'mp4/best'}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return ydl.prepare_filename(info)

def transcribe_and_clip(video_path):
    result = model.transcribe(video_path, verbose=False)
    segments = result['segments']

    highlights = []
    for seg in segments:
        text = seg['text'].strip()
        dur = seg['end'] - seg['start']
        excitement = text.count("!") + text.count("?")
        long_text = len(text.split()) / (dur + 0.1)
        score = excitement * 2 + long_text
        if 8 < dur < 60:
            highlights.append((score, seg))
    highlights.sort(key=lambda x: x[0], reverse=True)
    top_segments = [s for _, s in highlights[:5]]

    clip_files = []
    for i, seg in enumerate(top_segments):
        start = max(seg["start"] - 0.5, 0)
        end = seg["end"] + 0.5
        out_path = os.path.join(OUTPUT_DIR, f"clip_{i+1}.mp4")
        ffmpeg_extract_subclip(video_path, start, end, targetname=out_path)
        clip_files.append(f"/{out_path}")
    return clip_files

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process', methods=['POST'])
def process():
    data = request.get_json()
    url = data.get("url")
    if not url:
        return jsonify({"error": "No URL provided"}), 400
    try:
        video_path = download_video(url)
        clips = transcribe_and_clip(video_path)
        return jsonify({"clips": clips})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)
