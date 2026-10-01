// assets/js/app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// assets/js/firebase-config.js
var firebaseConfig = {
  apiKey: "AIzaSyC8i58DEUXA9g3sNkUw86QSNlAOtg7tkz4",
  authDomain: "amore-40efc.firebaseapp.com",
  projectId: "amore-40efc",
  storageBucket: "amore-40efc.firebasestorage.app",
  messagingSenderId: "588175180318",
  appId: "1:588175180318:web:98020d67d835ea6990240f",
  measurementId: "G-RL4SK7Y05H"
};
var firebaseSpaceId = "amore-40efc";

// assets/js/app.js
(function() {
  "use strict";
  const defaults = {
    todos: [],
    events: [],
    cycles: [],
    gallery: [],
    settings: { name: "Madel", showCycleOnDashboard: false, lettersRead: [] },
    letters: []
  };
  const reminderNotes = [
    "The small things are the big things.",
    "You make the ordinary feel like home.",
    "I'd choose your company on any kind of day.",
    "My favorite place is wherever we both are.",
    "Here's to all the little moments still ahead.",
    "You make the days softer just by being here.",
    "Home is a feeling, and you feel like home.",
    "Even an ordinary Tuesday is brighter with you."
  ];
  function chooseReminderNote() {
    let previousIndex = -1;
    try {
      previousIndex = Number(sessionStorage.getItem("amore:last-reminder"));
    } catch {
    }
    const choices = reminderNotes.map((_, index) => index).filter((index) => index !== previousIndex);
    const nextIndex = choices[Math.floor(Math.random() * choices.length)];
    try {
      sessionStorage.setItem("amore:last-reminder", String(nextIndex));
    } catch {
    }
    return reminderNotes[nextIndex];
  }
  const reminderNote = chooseReminderNote();
  const firebaseApp = initializeApp(firebaseConfig);
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);
  const legacyKeys = Object.keys(defaults);
  const cache = Object.fromEntries(legacyKeys.map((key) => [key, readLegacyData(key) ?? structuredClone(defaults[key])]));
  const listeners = /* @__PURE__ */ new Map();
  let currentUser = null;
  let cloudReady = false;
  let cloudFailed = false;
  let cloudUnsubscribers = [];
  function readLegacyData(key) {
    try {
      const raw = localStorage.getItem(`our-space:${key}`);
      return raw === null ? void 0 : JSON.parse(raw);
    } catch (error) {
      console.error(`Could not read legacy ${key} data.`, error);
      return void 0;
    }
  }
  function removeLegacyData(key) {
    try {
      localStorage.removeItem(`our-space:${key}`);
    } catch (error) {
      console.warn(`Could not remove migrated ${key} cache.`, error);
    }
  }
  function loadData(key) {
    return cache[key];
  }
  function saveData(key, data) {
    if (!cloudReady) {
      toast(cloudFailed ? "Firestore is unavailable; this change was not saved." : "Connecting to Firestore. Try saving again in a moment.");
      return Promise.resolve(false);
    }
    return writeCloudData(key, data).then(() => {
      cache[key] = data;
      notifyDataChanged(key);
      return true;
    }).catch((error) => {
      console.error(`Could not save ${key} to Firestore.`, error);
      toast("Could not save to Firestore. Check the connection and database rules.");
      return false;
    });
  }
  function deleteData(key) {
    if (!cloudReady) return Promise.resolve(false);
    const reference = dataReference(key);
    return deleteDoc(reference).then(() => true).catch((error) => {
      console.error(`Could not delete ${key} from Firestore.`, error);
      toast("Could not delete from Firestore.");
      return false;
    });
  }
  function dataReference(key) {
    if (key === "cycles") return doc(db, "users", currentUser.uid, "privateData", "cycles");
    return doc(db, "spaces", firebaseSpaceId, "data", key);
  }
  function galleryReference() {
    return collection(db, "spaces", firebaseSpaceId, "gallery");
  }
  async function loadGallery() {
    const snapshot = await getDocs(galleryReference());
    return Promise.all(snapshot.docs.map(async (photoDoc) => {
      const photo = photoDoc.data();
      if (photo.imageKind !== "base64") return { ...photo, id: photoDoc.id, image: photo.image || "" };
      const chunks = await getDocs(query(collection(photoDoc.ref, "chunks"), orderBy("index")));
      const encoded = chunks.docs.map((chunk) => chunk.data().value).join("");
      return { ...photo, id: photoDoc.id, image: `data:${photo.mimeType};base64,${encoded}` };
    }));
  }
  async function commitOperations(operations) {
    for (let offset = 0; offset < operations.length; offset += 400) {
      const batch = writeBatch(db);
      operations.slice(offset, offset + 400).forEach((operation) => operation(batch));
      await batch.commit();
    }
  }
  async function removePhotoChunks(photoReference) {
    const chunks = await getDocs(collection(photoReference, "chunks"));
    if (chunks.empty) return;
    await commitOperations(chunks.docs.map((chunk) => (batch) => batch.delete(chunk.ref)));
  }
  async function saveGallery(photos) {
    const photosRef = galleryReference();
    const existing = await getDocs(photosRef);
    const nextIds = new Set(photos.map((photo) => photo.id));
    for (const oldPhoto of existing.docs) {
      if (nextIds.has(oldPhoto.id)) continue;
      await removePhotoChunks(oldPhoto.ref);
      await deleteDoc(oldPhoto.ref);
    }
    for (const photo of photos) {
      const photoRef = doc(photosRef, photo.id);
      let image = photo.image;
      if (!image.startsWith("data:")) {
        const response = await fetch(`${getBasePath()}assets/images/${encodeURIComponent(image)}`);
        if (!response.ok) throw new Error(`Could not load gallery image ${image}.`);
        const blob = await response.blob();
        const reader = new FileReader();
        image = await new Promise((resolve, reject) => {
          reader.addEventListener("load", () => resolve(String(reader.result)));
          reader.addEventListener("error", () => reject(new Error(`Could not encode sample image ${image}.`)));
          reader.readAsDataURL(blob);
        });
      }
      const dataUrlMatch = image.match(/^data:([^;,]+);base64,([\s\S]*)$/);
      if (!dataUrlMatch) throw new Error(`Image ${photo.id} is not a Base64 data URL.`);
      const [, mimeType, encoded] = dataUrlMatch;
      const chunkSize = 7e5;
      const values = Array.from({ length: Math.ceil(encoded.length / chunkSize) }, (_, index) => encoded.slice(index * chunkSize, (index + 1) * chunkSize));
      const oldChunks = await getDocs(collection(photoRef, "chunks"));
      const operations = values.map((value, index) => (batch) => batch.set(doc(photoRef, "chunks", String(index).padStart(6, "0")), { index, value }));
      oldChunks.docs.forEach((chunk) => {
        if (Number(chunk.data().index) >= values.length) operations.push((batch) => batch.delete(chunk.ref));
      });
      await commitOperations(operations);
      await setDoc(photoRef, {
        id: photo.id,
        caption: photo.caption,
        date: photo.date,
        favorite: Boolean(photo.favorite),
        imageKind: "base64",
        mimeType,
        chunkCount: values.length,
        updatedAt: serverTimestamp()
      });
    }
  }
  async function writeCloudData(key, data) {
    if (key === "gallery") {
      await saveGallery(data);
      await setDoc(dataReference(key), { initialized: true, updatedAt: serverTimestamp() });
      return;
    }
    await setDoc(dataReference(key), { value: data, updatedAt: serverTimestamp() });
  }
  async function readCloudData(key) {
    if (key === "gallery") {
      const gallery = await loadGallery();
      const marker = await getDoc(dataReference(key));
      if (gallery.length || marker.exists()) return gallery;
      const seed2 = cache.gallery;
      await writeCloudData(key, seed2);
      return seed2;
    }
    const reference = dataReference(key);
    const snapshot = await getDoc(reference);
    if (snapshot.exists()) return snapshot.data().value;
    const seed = cache[key];
    await writeCloudData(key, seed);
    return seed;
  }
  function notifyDataChanged(key) {
    window.dispatchEvent(new CustomEvent("space:data-changed", { detail: { key } }));
  }
  async function initializeCloud() {
    try {
      const credential = await signInAnonymously(auth);
      currentUser = credential.user;
      for (const key of legacyKeys) {
        cache[key] = await readCloudData(key);
        removeLegacyData(key);
      }
      cloudReady = true;
      cloudUnsubscribers = legacyKeys.map((key) => {
        const reference = key === "gallery" ? galleryReference() : dataReference(key);
        return onSnapshot(reference, async (snapshot) => {
          try {
            if (key === "gallery") cache.gallery = await loadGallery();
            else if (snapshot.exists()) cache[key] = snapshot.data().value;
            notifyDataChanged(key);
          } catch (error) {
            console.error(`Could not refresh ${key} from Firestore.`, error);
          }
        }, (error) => {
          console.error(`Firestore listener failed for ${key}.`, error);
        });
      });
      window.dispatchEvent(new CustomEvent("space:ready"));
    } catch (error) {
      console.error("Firebase initialization failed.", error);
      cloudFailed = true;
      toast("Could not connect to Firestore. Check Firebase setup, anonymous sign-in, and database rules.");
      window.dispatchEvent(new CustomEvent("space:connection-failed"));
    }
  }
  function toast(message) {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("aria-live", "polite");
      document.body.append(region);
    }
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), 3200);
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function formatDate(value, options = { month: "long", day: "numeric" }) {
    if (!value) return "No date";
    return new Intl.DateTimeFormat(void 0, options).format(/* @__PURE__ */ new Date(`${value}T12:00:00`));
  }
  function localDateString(date = /* @__PURE__ */ new Date()) {
    const value = date instanceof Date ? date : new Date(date);
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 6e4);
    return local.toISOString().slice(0, 10);
  }
  function getBasePath() {
    return document.body.dataset.basePath || "";
  }
  let birthdayPopupShown = false;
  let birthdayAudioContext = null;
  let birthdayAudioTimer = null;
  function stopBirthdayTune() {
    window.clearTimeout(birthdayAudioTimer);
    birthdayAudioTimer = null;
    if (birthdayAudioContext) {
      const context = birthdayAudioContext;
      birthdayAudioContext = null;
      context.close().catch((error) => console.error("Could not stop birthday tune.", error));
    }
    const button = document.querySelector("[data-birthday-play]");
    if (button) button.textContent = "Play birthday tune";
  }
  function playBirthdayTune() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      toast("Audio playback is not supported by this browser.");
      return;
    }
    stopBirthdayTune();
    try {
      const context = new AudioContextClass();
      birthdayAudioContext = context;
      const notes = [
        ["G4", 1],
        ["G4", 1],
        ["A4", 2],
        ["G4", 2],
        ["C5", 2],
        ["B4", 4],
        ["G4", 1],
        ["G4", 1],
        ["A4", 2],
        ["G4", 2],
        ["D5", 2],
        ["C5", 4],
        ["G4", 1],
        ["G4", 1],
        ["G5", 2],
        ["E5", 2],
        ["C5", 2],
        ["B4", 2],
        ["A4", 4],
        ["F5", 1],
        ["F5", 1],
        ["E5", 2],
        ["C5", 2],
        ["D5", 2],
        ["C5", 4]
      ];
      const frequencies = {
        G4: 392,
        A4: 440,
        B4: 493.88,
        C5: 523.25,
        D5: 587.33,
        E5: 659.25,
        F5: 698.46,
        G5: 783.99
      };
      const beat = 60 / 184;
      const startAt = context.currentTime + 0.08;
      let elapsed = 0;
      const playTone = (frequency, at, duration, waveform, peak) => {
        const oscillator = context.createOscillator();
        const volume = context.createGain();
        oscillator.type = waveform;
        oscillator.frequency.value = frequency;
        volume.gain.setValueAtTime(1e-4, at);
        volume.gain.exponentialRampToValueAtTime(peak, at + 0.015);
        volume.gain.exponentialRampToValueAtTime(1e-4, at + duration);
        oscillator.connect(volume);
        volume.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + duration);
      };
      const midiFrequency = (note) => 440 * 2 ** ((note - 69) / 12);
      const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.12), context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let index = 0; index < noiseData.length; index += 1) noiseData[index] = Math.random() * 2 - 1;
      const playNoiseHit = (at, duration, peak, filterType, filterFrequency) => {
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const volume = context.createGain();
        source.buffer = noiseBuffer;
        filter.type = filterType;
        filter.frequency.value = filterFrequency;
        volume.gain.setValueAtTime(peak, at);
        volume.gain.exponentialRampToValueAtTime(1e-4, at + duration);
        source.connect(filter);
        filter.connect(volume);
        volume.connect(context.destination);
        source.start(at);
        source.stop(at + duration);
      };
      const playKick = (at) => {
        const oscillator = context.createOscillator();
        const volume = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(145, at);
        oscillator.frequency.exponentialRampToValueAtTime(48, at + 0.13);
        volume.gain.setValueAtTime(0.22, at);
        volume.gain.exponentialRampToValueAtTime(1e-4, at + 0.15);
        oscillator.connect(volume);
        volume.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.16);
      };
      notes.forEach(([note, beats]) => {
        const startAtNote = startAt + elapsed;
        const duration = beats * beat * 0.88;
        playTone(frequencies[note], startAtNote, duration, "triangle", 0.12);
        elapsed += beats * beat;
      });
      const chords = [
        [55, 59, 62],
        [48, 52, 55],
        [50, 54, 57],
        [55, 59, 62],
        [55, 59, 62],
        [48, 52, 55],
        [50, 54, 57],
        [55, 59, 62],
        [55, 59, 62],
        [48, 52, 55],
        [50, 54, 57],
        [55, 59, 62],
        [53, 57, 60],
        [48, 52, 55],
        [50, 54, 57],
        [48, 52, 55]
      ];
      const totalBeats = elapsed / beat;
      for (let tick = 0; tick < Math.ceil(totalBeats * 2); tick += 1) {
        const beatPosition = tick / 2;
        const chord = chords[Math.floor(beatPosition / 4) % chords.length];
        const at = startAt + beatPosition * beat;
        if (tick % 2 === 0) {
          const beatInBar = Math.floor(beatPosition) % 4;
          if (beatInBar === 0 || beatInBar === 2) playKick(at);
          else playNoiseHit(at, 0.11, 0.075, "bandpass", 1800);
          chord.slice(1).forEach((note) => playTone(midiFrequency(note + 12), at, beat * 0.16, "triangle", 0.025));
        }
        playNoiseHit(at, 0.045, tick % 2 === 1 ? 0.025 : 0.012, "highpass", 7500);
        if (tick % 4 === 0) {
          playTone(midiFrequency(chord[0] - 12), at, beat * 0.42, "sine", 0.09);
        } else if (tick % 2 === 1) {
          const arpeggioNote = chord[Math.floor(beatPosition * 2) % 3];
          playTone(midiFrequency(arpeggioNote + 12), at, beat * 0.22, "triangle", 0.035);
        }
      }
      const button = document.querySelector("[data-birthday-play]");
      if (button) button.textContent = "Stop birthday tune";
      birthdayAudioTimer = window.setTimeout(stopBirthdayTune, elapsed * 1e3 + 200);
    } catch (error) {
      stopBirthdayTune();
      console.error("Could not play birthday tune.", error);
      toast("Could not play the birthday tune.");
    }
  }
  function showBirthdayPopup(name) {
    if (birthdayPopupShown) return;
    birthdayPopupShown = true;
    const backdrop = document.createElement("div");
    backdrop.className = "birthday-backdrop";
    backdrop.innerHTML = `<section class="birthday-card" role="dialog" aria-modal="true" aria-labelledby="birthday-title"><button class="birthday-close" type="button" data-birthday-close aria-label="Close birthday greeting">\xD7</button><div class="birthday-confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, index) => `<span style="--confetti-left:${(index * 100 / 24).toFixed(2)}%;--confetti-delay:-${index % 8 * 0.2}s"></span>`).join("")}</div><span class="birthday-cake" aria-hidden="true">\u{1F382}</span><p class="eyebrow">A special day for you</p><h2 id="birthday-title">Happy Birthday, ${escapeHTML(name)}!</h2><p class="birthday-message">I hope your day is filled with all the love and happiness you bring to everyone around you. \u2661</p><button class="button birthday-play" type="button" data-birthday-play>Play birthday tune</button></section>`;
    document.body.append(backdrop);
    const close = () => {
      stopBirthdayTune();
      backdrop.remove();
    };
    backdrop.querySelector("[data-birthday-close]").addEventListener("click", close);
    backdrop.querySelector("[data-birthday-play]").addEventListener("click", (event) => {
      if (birthdayAudioContext) stopBirthdayTune();
      else playBirthdayTune();
      event.currentTarget.textContent = birthdayAudioContext ? "Stop birthday tune" : "Play birthday tune";
    });
    backdrop.querySelector("[data-birthday-close]").focus();
  }
  function renderNavigation() {
    const mount = document.querySelector("[data-site-nav]");
    if (!mount) return;
    const base = getBasePath();
    const current = document.body.dataset.page || "home";
    const links = [
      ["home", "Home", "\u2302", "index.html"],
      ["todos", "Todo", "\u2713", "todos/index.html"],
      ["events", "Events", "\u25F7", "events/index.html"],
      ["tracker", "Tracker", "\u25CC", "menstrual-tracker/index.html"],
      ["gallery", "Gallery", "\u25A7", "gallery/index.html"],
      ["letters", "Letters", "\u2661", "letters/index.html"]
    ];
    mount.innerHTML = `<header class="site-header"><a class="brand" href="${base}index.html"><span class="brand-mark" aria-hidden="true">\u2661</span><span class="brand-name">Amore</span></a><nav class="primary-nav" aria-label="Main navigation">${links.map(([id, label, symbol, path]) => `<a href="${base}${path}"${id === current ? ' aria-current="page"' : ""}><span class="nav-symbol" aria-hidden="true">${symbol}</span><span>${label}</span></a>`).join("")}</nav></header>`;
  }
  function checkForAndroidUpdate() {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    import("./android-updater.js").then(({ AppUpdater }) => AppUpdater.checkForUpdate()).then((update) => {
      if (!update.available) return;
      window.setTimeout(() => {
        if (!window.confirm(`Amore ${update.version} is available. Download and install it now? Android will ask you to confirm the installation.`)) return;
        import("./android-updater.js").then(({ AppUpdater }) => AppUpdater.installLatestRelease()).then(() => toast("The Android installer opened. Follow its instructions to finish the update.")).catch((error) => {
          console.error("Could not start the Amore update.", error);
          toast("Could not start the update. Check Android's install permission and try again.");
        });
      }, 1500);
    }).catch((error) => {
      console.error("Could not check for an Amore update.", error);
      toast("Could not check for app updates. Check your internet connection.");
    });
  }
  function renderDashboard() {
    const root = document.querySelector("[data-dashboard]");
    if (!root) return;
    const todos = loadData("todos");
    const events = loadData("events");
    const gallery = loadData("gallery");
    const settings = loadData("settings");
    const today = localDateString();
    const now = /* @__PURE__ */ new Date();
    if (now.getMonth() === 9 && now.getDate() === 2) showBirthdayPopup(settings.name || "Madel");
    const hour = now.getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const activeToday = todos.filter((todo) => !todo.completed && (!todo.dueDate || todo.dueDate <= today)).length;
    const nextEvent = events.filter((event) => event.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const letters = loadData("letters");
    const nextLetter = letters.find((letter) => !settings.lettersRead.includes(letter.file));
    const latestLetter = [...letters].sort((a, b) => b.date.localeCompare(a.date))[0];
    const recentPhotos = [...gallery].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    const daysToEvent = nextEvent ? Math.ceil((/* @__PURE__ */ new Date(`${nextEvent.date}T12:00:00`) - /* @__PURE__ */ new Date(`${today}T12:00:00`)) / 864e5) : null;
    const cycle = loadData("cycles").sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    let cycleContent = `<p class="widget-copy">Private tracker details are hidden here.</p><a class="text-link" href="menstrual-tracker/index.html">Open private tracker \u2192</a>`;
    if (settings.showCycleOnDashboard && cycle) {
      const day = Math.max(1, Math.floor((/* @__PURE__ */ new Date(`${today}T12:00:00`) - /* @__PURE__ */ new Date(`${cycle.startDate}T12:00:00`)) / 864e5) + 1);
      cycleContent = `<p class="widget-number">Day ${day}</p><p class="widget-copy">Estimated next period ${formatDate(localDateString((/* @__PURE__ */ new Date(`${cycle.startDate}T12:00:00`)).setDate((/* @__PURE__ */ new Date(`${cycle.startDate}T12:00:00`)).getDate() + (cycle.cycleLength || 28))))}</p><a class="text-link" href="menstrual-tracker/index.html">Open private tracker \u2192</a>`;
    }
    root.innerHTML = `
      <section class="welcome-panel"><div><p class="eyebrow">A SPACE FOR THE TWO OF US</p><h1>${greeting}, <span data-name>${escapeHTML(settings.name || "Madel")}</span> <span class="heart" aria-hidden="true">\u2661</span></h1><p class="welcome-date">${new Intl.DateTimeFormat(void 0, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now)}</p></div></section>
      <section class="dashboard-grid" aria-label="Your shared space">
        <article class="widget todo-widget"><div class="widget-top"><span class="widget-icon">\u2713</span><span class="eyebrow">Little plans</span></div><p class="widget-number">${activeToday} <span>left today</span></p><p class="widget-copy">${activeToday ? "One small thing at a time." : "All done for today! \u2661"}</p><a class="text-link" href="todos/index.html">Open your list \u2192</a></article>
        <article class="widget event-widget"><div class="widget-top"><span class="widget-icon">\u25F7</span><span class="eyebrow">Next together</span></div>${nextEvent ? `<p class="widget-number widget-title">${escapeHTML(nextEvent.title)}</p><p class="widget-copy">${formatDate(nextEvent.date)}${nextEvent.time ? ` \xB7 ${escapeHTML(nextEvent.time)}` : ""}</p><span class="countdown">${daysToEvent === 0 ? "Today" : `${daysToEvent} ${daysToEvent === 1 ? "day" : "days"} to go`}</span>` : `<p class="widget-copy">Nothing on the calendar just yet.</p>`}<a class="text-link" href="events/index.html">See your calendar \u2192</a></article>
        <article class="widget cycle-widget"><div class="widget-top"><span class="widget-icon">\u25CC</span><span class="eyebrow">Private, by default</span></div>${cycleContent}<label class="privacy-toggle"><input type="checkbox" data-cycle-privacy ${settings.showCycleOnDashboard ? "checked" : ""}><span>Show tracker summary on home</span></label></article>
        <article class="widget gallery-widget"><div class="widget-top"><span class="widget-icon">\u25A7</span><span class="eyebrow">Little memories</span></div><p class="widget-number">${gallery.length} <span>moments saved</span></p><div class="mini-gallery">${recentPhotos.map((photo) => `<img src="${photo.image.startsWith("data:") ? photo.image : `assets/images/${escapeHTML(photo.image)}`}" alt="${escapeHTML(photo.caption)}">`).join("")}</div><a class="text-link" href="gallery/index.html">Visit the album \u2192</a></article>
        <article class="widget letter-widget"><div class="widget-top"><span class="widget-icon">\u2661</span><span class="eyebrow">A note for you</span></div><p class="widget-number widget-title">${latestLetter ? escapeHTML(latestLetter.title) : "No letters yet"}</p><p class="widget-copy">${latestLetter ? escapeHTML(latestLetter.teaser || (nextLetter ? "A little letter is waiting when you have a quiet minute." : "A note to revisit whenever you like.")) : "Your letter shelf is ready when you are."}</p><a class="text-link" href="letters/index.html">${nextLetter ? "Read your letter \u2192" : latestLetter ? "Revisit a letter \u2192" : "Open your letters \u2192"}</a></article>
        <article class="widget date-widget"><span class="date-flower" aria-hidden="true">\u2733</span><p class="eyebrow">A gentle reminder</p><p class="widget-number widget-title">${escapeHTML(reminderNote)}</p><p class="widget-copy">Save a moment, make a plan, or just stay a while.</p></article>
      </section>
      <section class="dashboard-lower"><div class="lower-heading"><div><p class="eyebrow">Coming up</p><h2>Things to look forward to</h2></div><a class="text-link" href="events/index.html">All events \u2192</a></div><div class="upcoming-row">${events.filter((event) => event.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3).map((event) => `<article class="upcoming-item"><span class="event-dot category-${escapeHTML(event.category.toLowerCase())}"></span><div><strong>${escapeHTML(event.title)}</strong><span>${formatDate(event.date)} \xB7 ${escapeHTML(event.location || event.category)}</span></div></article>`).join("") || `<p class="muted">No plans yet \u2661 Maybe it's time to make one.</p>`}</div></section>`;
    root.querySelector("[data-cycle-privacy]").addEventListener("change", (event) => {
      settings.showCycleOnDashboard = event.target.checked;
      saveData("settings", settings);
      renderDashboard();
    });
  }
  window.Space = { loadData, saveData, deleteData, toast, escapeHTML, formatDate, localDateString, getBasePath, get ready() {
    return cloudReady;
  } };
  renderNavigation();
  checkForAndroidUpdate();
  renderDashboard();
  window.addEventListener("space:data-changed", (event) => {
    if (["todos", "events", "gallery", "settings", "cycles", "letters"].includes(event.detail.key)) renderDashboard();
  });
  window.addEventListener("space:ready", renderDashboard);
  window.addEventListener("space:connection-failed", renderDashboard);
  initializeCloud();
})();

// assets/js/image-utils.js
var imageExtensions = /* @__PURE__ */ new Set(["ai", "apng", "arw", "avif", "bmp", "cr2", "dds", "dng", "eps", "exr", "gif", "heic", "heif", "ico", "j2c", "j2k", "jng", "jp2", "jpe", "jpf", "jpx", "jxl", "mng", "nef", "orf", "pcx", "png", "psd", "raw", "rw2", "svg", "tga", "tif", "tiff", "webp", "xcf", "xpm", "jpg", "jpeg"]);
var mimeByExtension = { heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", jxl: "image/jxl", avif: "image/avif", dng: "image/x-adobe-dng", cr2: "image/x-canon-cr2", nef: "image/x-nikon-nef", arw: "image/x-sony-arw", orf: "image/x-olympus-orf", rw2: "image/x-panasonic-rw2", psd: "image/vnd.adobe.photoshop", raw: "image/x-raw" };
var preserveOriginalExtensions = /* @__PURE__ */ new Set(["gif", "svg", "heic", "heif", "jxl", "dng", "cr2", "nef", "arw", "orf", "rw2", "psd", "raw"]);
function fileExtension(file) {
  return file.name.split(".").pop().toLowerCase();
}
function isImageFile(file) {
  return file.type.startsWith("image/") || imageExtensions.has(fileExtension(file));
}
function readAsDataUrl(blob, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result).replace(/^data:[^;,]*/, `data:${mimeType}`)));
    reader.addEventListener("error", () => reject(new Error("The selected image could not be read.")));
    reader.readAsDataURL(blob);
  });
}
async function encodeImage(file) {
  const extension = fileExtension(file);
  const mimeType = file.type.startsWith("image/") ? file.type : mimeByExtension[extension] || `image/${extension}`;
  if (!preserveOriginalExtensions.has(extension) && "createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const compressed = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
      if (compressed && compressed.size < file.size) return readAsDataUrl(compressed, "image/webp");
    } catch (error) {
      console.info(`Keeping original ${extension} image; this browser cannot re-encode it.`, error);
    }
  }
  return readAsDataUrl(file, mimeType);
}

// admin/admin.js
(function() {
  "use strict";
  const app = document.querySelector("#admin-app");
  const letterForm = app.querySelector("[data-letter-form]");
  const photoForm = app.querySelector("[data-photo-form]");
  const letterList = app.querySelector("[data-letter-list]");
  const photoList = app.querySelector("[data-photo-list]");
  let letters = Space.loadData("letters");
  let photos = Space.loadData("gallery");
  let editingLetterId = null;
  const basePath = Space.getBasePath();
  let dataLoaded = Boolean(Space.ready);
  let dataLoadFailed = false;
  function photoSource(photo) {
    return photo.image.startsWith("data:") ? photo.image : `${basePath}assets/images/${encodeURIComponent(photo.image)}`;
  }
  function renderLetters() {
    app.querySelector("[data-letter-count]").textContent = `${letters.length} ${letters.length === 1 ? "letter" : "letters"}`;
    letterList.innerHTML = letters.length ? [...letters].sort((a, b) => b.date.localeCompare(a.date)).map((letter) => `<article class="admin-record" data-letter-id="${Space.escapeHTML(letter.id)}"><div class="admin-record-main"><p class="admin-record-title">${Space.escapeHTML(letter.title)}</p><p class="admin-record-meta">${Space.formatDate(letter.date, { month: "short", day: "numeric", year: "numeric" })}</p></div><div class="admin-record-actions"><button class="icon-button" type="button" data-edit-letter aria-label="Edit ${Space.escapeHTML(letter.title)}" title="Edit">\u270E</button><button class="button danger small" type="button" data-delete-letter aria-label="Delete ${Space.escapeHTML(letter.title)}">Delete</button></div></article>`).join("") : `<p class="admin-empty">${dataLoadFailed ? "Could not load letters from Firestore. Check the connection and try again." : dataLoaded ? "No letters have been published to Firestore yet." : "Loading published letters from Firestore\u2026"}</p>`;
  }
  function renderPhotos() {
    app.querySelector("[data-photo-count]").textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`;
    photoList.innerHTML = photos.length ? [...photos].sort((a, b) => b.date.localeCompare(a.date)).map((photo) => `<article class="admin-record" data-photo-id="${Space.escapeHTML(photo.id)}"><img class="admin-photo-thumb" src="${photoSource(photo)}" alt=""><div class="admin-record-main"><p class="admin-record-title">${Space.escapeHTML(photo.caption)}</p><p class="admin-record-meta">${Space.formatDate(photo.date, { month: "short", day: "numeric", year: "numeric" })}</p></div><div class="admin-record-actions"><button class="icon-button" type="button" data-delete-photo aria-label="Delete ${Space.escapeHTML(photo.caption)}" title="Delete">\xD7</button></div></article>`).join("") : `<p class="admin-empty">${dataLoadFailed ? "Could not load photos from Firestore. Check the connection and try again." : dataLoaded ? "No photos have been published to Firestore yet." : "Loading photos from Firestore\u2026"}</p>`;
  }
  function render() {
    renderLetters();
    renderPhotos();
  }
  function setStatus(message, state = "") {
    const status = app.querySelector("[data-admin-status]");
    status.textContent = message;
    status.dataset.state = state;
  }
  function resetLetterForm() {
    editingLetterId = null;
    letterForm.reset();
    letterForm.elements.date.value = Space.localDateString();
    letterForm.querySelector("[data-letter-submit]").textContent = "Publish letter";
    letterForm.querySelector("[data-letter-cancel]").hidden = true;
  }
  function letterBodyFromContent(content) {
    const parsed = new DOMParser().parseFromString(content || "", "text/html");
    return [...parsed.querySelectorAll(".letter-paragraph")].map((paragraph) => paragraph.innerText).join("\n\n");
  }
  function escapeParagraph(value) {
    return Space.escapeHTML(value).replace(/\r?\n/g, "<br>");
  }
  letterForm.elements.date.value = Space.localDateString();
  letterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = letterForm.querySelector("[data-letter-submit]");
    submitButton.disabled = true;
    setStatus("Publishing letter to Firestore\u2026");
    try {
      const fields = new FormData(letterForm);
      const title = fields.get("title").trim();
      const date = fields.get("date");
      const teaser = fields.get("teaser").trim();
      const paragraphs = fields.get("body").trim().split(/\n\s*\n/).filter(Boolean);
      const existing = letters.find((letter2) => letter2.id === editingLetterId);
      const id = existing?.id || crypto.randomUUID();
      const file = existing?.file || `${id}.html`;
      const kicker = `${Space.formatDate(date, { month: "long", day: "numeric", year: "numeric" })} \xB7 A note for you`;
      const content = `<article class="letter-document"><p class="letter-kicker">${Space.escapeHTML(kicker)}</p><h1>${Space.escapeHTML(title)}</h1>${paragraphs.map((paragraph) => `<p class="letter-paragraph">${escapeParagraph(paragraph)}</p>`).join("")}</article>`;
      const letter = { id, file, title, date, teaser, content };
      const nextLetters = existing ? letters.map((item) => item.id === id ? letter : item) : [...letters, letter];
      const saved = await Space.saveData("letters", nextLetters);
      if (!saved) {
        setStatus("Letter was not saved. Check Firestore connection and rules.", "error");
        return;
      }
      letters = nextLetters;
      resetLetterForm();
      renderLetters();
      setStatus("Letter published to Firestore and the shared site", "ready");
    } catch (error) {
      console.error("Could not publish letter.", error);
      setStatus("Letter was not published. Check the form and try again.", "error");
    } finally {
      submitButton.disabled = false;
    }
  });
  letterForm.querySelector("[data-letter-cancel]").addEventListener("click", resetLetterForm);
  letterList.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-letter-id]");
    if (!row) return;
    const letter = letters.find((item) => item.id === row.dataset.letterId);
    if (!letter) return;
    if (event.target.closest("[data-edit-letter]")) {
      editingLetterId = letter.id;
      letterForm.elements.title.value = letter.title;
      letterForm.elements.date.value = letter.date;
      letterForm.elements.teaser.value = letter.teaser;
      letterForm.elements.body.value = letterBodyFromContent(letter.content);
      letterForm.querySelector("[data-letter-submit]").textContent = "Save changes";
      letterForm.querySelector("[data-letter-cancel]").hidden = false;
      letterForm.elements.title.focus();
    }
    if (event.target.closest("[data-delete-letter]") && window.confirm(`Delete \u201C${letter.title}\u201D from the shared letters?`)) {
      const nextLetters = letters.filter((item) => item.id !== letter.id);
      const settings = Space.loadData("settings");
      settings.lettersRead = (settings.lettersRead || []).filter((file) => file !== letter.file);
      const letterSaved = await Space.saveData("letters", nextLetters);
      const settingsSaved = await Space.saveData("settings", settings);
      if (!letterSaved || !settingsSaved) {
        setStatus("Firestore delete failed", "error");
        return;
      }
      letters = nextLetters;
      renderLetters();
      setStatus("Letter deleted from Firestore", "ready");
    }
  });
  photoForm.elements.date.value = Space.localDateString();
  photoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = photoForm.elements.image.files?.[0];
    if (!file || !isImageFile(file)) {
      Space.toast("Choose an image file to upload.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      Space.toast("Images must be under 100 MB for Firestore Base64 storage.");
      return;
    }
    const submitButton = photoForm.querySelector("[data-photo-submit]");
    submitButton.disabled = true;
    setStatus("Preparing image\u2026");
    try {
      const image = await encodeImage(file);
      const fields = new FormData(photoForm);
      const photo = { id: crypto.randomUUID(), image, caption: fields.get("caption").trim(), date: fields.get("date"), favorite: false };
      const nextPhotos = [photo, ...photos];
      const saved = await Space.saveData("gallery", nextPhotos);
      if (!saved) {
        setStatus("Firestore upload failed", "error");
        return;
      }
      photos = nextPhotos;
      photoForm.reset();
      photoForm.elements.date.value = Space.localDateString();
      renderPhotos();
      setStatus("Photo published to the shared gallery", "ready");
    } catch (error) {
      console.error("Could not upload gallery photo.", error);
      setStatus("Image upload failed", "error");
    } finally {
      submitButton.disabled = false;
    }
  });
  photoList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-photo]");
    if (!button) return;
    const row = button.closest("[data-photo-id]");
    const photo = photos.find((item) => item.id === row?.dataset.photoId);
    if (!photo || !window.confirm(`Delete \u201C${photo.caption}\u201D from the shared gallery?`)) return;
    const nextPhotos = photos.filter((item) => item.id !== photo.id);
    const saved = await Space.saveData("gallery", nextPhotos);
    if (!saved) {
      setStatus("Firestore delete failed", "error");
      return;
    }
    photos = nextPhotos;
    renderPhotos();
    setStatus("Photo deleted from Firestore", "ready");
  });
  function refreshData() {
    letters = Space.loadData("letters");
    photos = Space.loadData("gallery");
    dataLoaded = true;
    dataLoadFailed = false;
    setStatus("Connected to Firestore", "ready");
    render();
  }
  window.addEventListener("space:ready", refreshData);
  window.addEventListener("space:data-changed", (event) => {
    if (event.detail.key === "letters" || event.detail.key === "gallery") refreshData();
  });
  window.addEventListener("space:connection-failed", () => {
    dataLoadFailed = true;
    render();
    setStatus("Firestore unavailable", "error");
  });
  render();
})();
