import { encodeImage, isImageFile } from "../assets/js/image-utils.js";

(function () {
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

  function photoSource(photo) {
    return photo.image.startsWith("data:") ? photo.image : `${basePath}assets/images/${encodeURIComponent(photo.image)}`;
  }

  function renderLetters() {
    app.querySelector("[data-letter-count]").textContent = `${letters.length} ${letters.length === 1 ? "letter" : "letters"}`;
    letterList.innerHTML = letters.length ? [...letters].sort((a, b) => b.date.localeCompare(a.date)).map((letter) => `<article class="admin-record" data-letter-id="${Space.escapeHTML(letter.id)}"><div class="admin-record-main"><p class="admin-record-title">${Space.escapeHTML(letter.title)}</p><p class="admin-record-meta">${Space.formatDate(letter.date, { month: "short", day: "numeric", year: "numeric" })}</p></div><div class="admin-record-actions"><button class="icon-button" type="button" data-edit-letter aria-label="Edit ${Space.escapeHTML(letter.title)}" title="Edit">✎</button><button class="icon-button" type="button" data-delete-letter aria-label="Delete ${Space.escapeHTML(letter.title)}" title="Delete">×</button></div></article>`).join("") : `<p class="admin-empty">No letters published yet.</p>`;
  }

  function renderPhotos() {
    app.querySelector("[data-photo-count]").textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`;
    photoList.innerHTML = photos.length ? [...photos].sort((a, b) => b.date.localeCompare(a.date)).map((photo) => `<article class="admin-record" data-photo-id="${Space.escapeHTML(photo.id)}"><img class="admin-photo-thumb" src="${photoSource(photo)}" alt=""><div class="admin-record-main"><p class="admin-record-title">${Space.escapeHTML(photo.caption)}</p><p class="admin-record-meta">${Space.formatDate(photo.date, { month: "short", day: "numeric", year: "numeric" })}</p></div><div class="admin-record-actions"><button class="icon-button" type="button" data-delete-photo aria-label="Delete ${Space.escapeHTML(photo.caption)}" title="Delete">×</button></div></article>`).join("") : `<p class="admin-empty">No photos in the shared gallery yet.</p>`;
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
    const fields = new FormData(letterForm);
    const title = fields.get("title").trim();
    const date = fields.get("date");
    const teaser = fields.get("teaser").trim();
    const paragraphs = fields.get("body").trim().split(/\n\s*\n/).filter(Boolean);
    const existing = letters.find((letter) => letter.id === editingLetterId);
    const id = existing?.id || crypto.randomUUID();
    const file = existing?.file || `${id}.html`;
    const kicker = `${Space.formatDate(date, { month: "long", day: "numeric", year: "numeric" })} · A note for you`;
    const content = `<article class="letter-document"><p class="letter-kicker">${Space.escapeHTML(kicker)}</p><h1>${Space.escapeHTML(title)}</h1>${paragraphs.map((paragraph) => `<p class="letter-paragraph">${escapeParagraph(paragraph)}</p>`).join("")}</article>`;
    const letter = { id, file, title, date, teaser, content };
    const nextLetters = existing ? letters.map((item) => item.id === id ? letter : item) : [...letters, letter];
    const saved = await Space.saveData("letters", nextLetters);
    if (!saved) { setStatus("Firestore save failed", "error"); return; }
    letters = nextLetters;
    resetLetterForm();
    renderLetters();
    setStatus("Changes saved to Firestore", "ready");
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
    if (event.target.closest("[data-delete-letter]") && window.confirm(`Delete “${letter.title}” from the shared letters?`)) {
      const nextLetters = letters.filter((item) => item.id !== letter.id);
      const settings = Space.loadData("settings");
      settings.lettersRead = (settings.lettersRead || []).filter((file) => file !== letter.file);
      const letterSaved = await Space.saveData("letters", nextLetters);
      const settingsSaved = await Space.saveData("settings", settings);
      if (!letterSaved || !settingsSaved) { setStatus("Firestore delete failed", "error"); return; }
      letters = nextLetters;
      renderLetters();
      setStatus("Letter deleted from Firestore", "ready");
    }
  });

  photoForm.elements.date.value = Space.localDateString();
  photoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = photoForm.elements.image.files?.[0];
    if (!file || !isImageFile(file)) { Space.toast("Choose an image file to upload."); return; }
    if (file.size > 100 * 1024 * 1024) { Space.toast("Images must be under 100 MB for Firestore Base64 storage."); return; }
    const submitButton = photoForm.querySelector("[data-photo-submit]");
    submitButton.disabled = true;
    setStatus("Preparing image…");
    try {
      const image = await encodeImage(file);
      const fields = new FormData(photoForm);
      const photo = { id: crypto.randomUUID(), image, caption: fields.get("caption").trim(), date: fields.get("date"), favorite: false };
      const nextPhotos = [photo, ...photos];
      const saved = await Space.saveData("gallery", nextPhotos);
      if (!saved) { setStatus("Firestore upload failed", "error"); return; }
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
    if (!photo || !window.confirm(`Delete “${photo.caption}” from the shared gallery?`)) return;
    const nextPhotos = photos.filter((item) => item.id !== photo.id);
    const saved = await Space.saveData("gallery", nextPhotos);
    if (!saved) { setStatus("Firestore delete failed", "error"); return; }
    photos = nextPhotos;
    renderPhotos();
    setStatus("Photo deleted from Firestore", "ready");
  });

  function refreshData() {
    letters = Space.loadData("letters");
    photos = Space.loadData("gallery");
    setStatus("Connected to Firestore", "ready");
    render();
  }

  window.addEventListener("space:ready", refreshData);
  window.addEventListener("space:data-changed", (event) => {
    if (event.detail.key === "letters" || event.detail.key === "gallery") refreshData();
  });
  window.addEventListener("space:connection-failed", () => setStatus("Firestore unavailable", "error"));
  render();
})();