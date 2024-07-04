const express = require("express");
const app = express();
const ytdl = require("ytdl-core");
const axios = require("axios");
const search = require("youtube-search");
const dotenv = require("dotenv");

dotenv.config();

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
          process.env.SPOTIFY_CLIENT_ID +
            ":" +
            process.env.SPOTIFY_CLIENT_SECRET
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

app.get("/download", async (req, res) => {
  const query = req.query.query;

  try {
    const songInfo = await searchSpotify(query);
    const videoUrl = await fetchYTUrl(`${songInfo.items[0].name} ${songInfo.items[0].artists[0].name} audio`);

  console.log(`${songInfo.items[0].name} ${songInfo.items[0].artists[0].name} audio`);

    if (!videoUrl) {
      throw new Error("No YouTube video found");
    }

    const videoInfo = await ytdl.getInfo(videoUrl);
    const audioFormats = ytdl.filterFormats(videoInfo.formats, "audioonly");

    if (audioFormats.length > 0) {
      const response = {
        name: songInfo.items[0].name,
        image: songInfo.items[0].album.images[0].url,
        artist: songInfo.items[0].artists[0].name,
        mp3Link: audioFormats[0].url,
      };
      res.json(response);
    } else {
      res.status(404).json({ error: "No audio formats found" });
    }
  } catch (error) {
    console.error("Error occurred:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
