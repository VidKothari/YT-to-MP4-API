const express = require("express");
const app = express();
const ytdl = require("ytdl-core");
const axios = require("axios");
const search = require("youtube-search");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const sanitize = require("sanitize-filename");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const FormData = require("form-data");

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

const opts = {
  maxResults: 1,
  key: process.env.YOUTUBE_API_KEY,
};

let accessToken = "";
let tokenTimestamp = null;

async function getAccessToken() {
  const authOptions = {
    url: "https://accounts.spotify.com/api/token",
    method: "post",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  };

  try {
    const response = await axios(authOptions);
    accessToken = response.data.access_token;
    tokenTimestamp = new Date();
  } catch (error) {
    console.error("Error fetching access token:", error.message);
    throw new Error("Failed to get Spotify access token");
  }
}

async function searchSpotify(query) {
  const oneHour = 60 * 60 * 1000;
  const now = new Date();

  if (!tokenTimestamp || now - tokenTimestamp > oneHour) {
    await getAccessToken();
  }

  const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
    query
  )}&type=track`;
  const options = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };

  try {
    const response = await axios.get(searchUrl, options);
    return response.data["tracks"];
  } catch (error) {
    console.error("Error searching Spotify:", error.message);
    throw new Error("Failed to search Spotify");
  }
}

async function fetchYTUrl(query) {
  return new Promise((resolve, reject) => {
    search(query, opts, (err, results) => {
      if (err) {
        console.error("YouTube search error:", err.message);
        return reject(new Error("Failed to search YouTube"));
      }
      const videoUrl = results[0]?.link;
      if (videoUrl) {
        resolve(videoUrl);
      } else {
        reject(new Error("No YouTube video found"));
      }
    });
  });
}

async function getSongRecommendation(description) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant. The user gives you a text description of a video, you give a suitable song that will go well with the vibe of the video, the format of which is songName, artistName. give nothing other than this",
      },
      {
        role: "user",
        content: description,
      },
    ],
  });

  const response = completion.choices[0].message.content;
  console.log(response);
  return response;
}

app.get("/download", async (req, res) => {
  const description = req.query.description;

  try {
    let songRecommendation = await getSongRecommendation(description);

    let songInfo = await searchSpotify(`${songRecommendation}`);
    console.log(songInfo.items[0]);
    let videoUrl = await fetchYTUrl(`${songInfo.items[0].name} ${songInfo.items[0].artists[0].name} audio`);
    console.log(videoUrl);

    if (!videoUrl) {
      throw new Error("No YouTube video found");
    }

    const outputFilePath = path.resolve(__dirname, `${songInfo.items[0].name}.mp3`);
    console.log(__dirname);
    console.log(outputFilePath);

    const stream = ytdl(videoUrl, { filter: 'audioonly' });
    var fileUrl = "";

    ffmpeg(stream)
      .audioBitrate(128)
      .save(outputFilePath)
      .on('end', () => {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(outputFilePath));

        axios.post('https://kodan-api-5955c011e5ae.herokuapp.com/uploadFile', formData, {
          headers: formData.getHeaders(),
        }).then((response) => {
          console.log("File uploaded successfully:", response.data);
          fileUrl = response.data.fileUrl;

          const responseData = {
            songName: songInfo.items[0].name,
            artistName: songInfo.items[0].artists[0].name,
            imageUrl: songInfo.items[0].album.images[0].url,
            fileUrl: fileUrl
          };
          
          res.send(responseData); 
        }).catch((error) => {
          console.error("Error uploading file:", error.message);
          res.status(500).json({ error: "Failed to upload file to CDN" });
        }).finally(() => {
          fs.unlinkSync(outputFilePath);
        });
      })
      .on('error', (err) => {
        console.error("Error during conversion:", err.message);
        res.status(500).json({ error: "Failed to convert YouTube video to MP3" });
      });

  } catch (error) {
    console.error("Error occurred:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
