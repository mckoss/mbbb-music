const works = [
  { title: "Bad Guy", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Baile Inolvidable", modified: "2026-02-17", assets: ["PDF parts"] },
  { title: "Bella Ciao", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Bumper to Bumper", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Dancing Queen", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Do Watcha Wanna", modified: "2025-11-16", assets: ["Parts", "Score"] },
  { title: "Feel Like Funkin It Up", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "For What It's Worth", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Free Bird in Thirty Seconds", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Freedom", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Get Lucky", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Gnosienne #1", modified: "2026-01-22", assets: ["PDF parts"] },
  { title: "Hava Negila", modified: "2025-11-14", assets: ["Parts", "Score"] },
  { title: "Hell", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Hot to Go", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Iko Iko", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Iron Man", modified: "2025-11-14", assets: ["Parts", "Score"] },
  { title: "It's Raining Men", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "It's Your Thing", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Jingle Bell Rock", modified: "2025-11-14", assets: ["Parts", "Score"] },
  { title: "Jump in the Line", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Lorenzo in Sicilia (Temptation)", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Matador", modified: "2026-01-07", assets: ["PDF parts"] },
  { title: "Moliendo Cafe", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Money - Pink Floyd", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Monster Mash", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Montero Road", modified: "2025-11-16", assets: ["Parts", "Score"] },
  { title: "Montserrat Serrat", modified: "2025-11-16", assets: ["Parts", "Score"] },
  { title: "Mr. Brightside", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Oye Como Va", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Ring of Fire", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Rock Anthem", modified: "2025-11-16", assets: ["Parts", "Score"] },
  { title: "Rock Lobster", modified: "2025-11-16", assets: ["Parts", "Score"] },
  { title: "SAIL (Meute)", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "SAT", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Shipping up to Boston", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Soulful Strut", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Stay Human", modified: "2025-11-16", assets: ["Parts", "Score"] },
  { title: "Sweet Dreams", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Thriller", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Track Suit By Bruce", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Unholy Score", modified: "2026-05-31", assets: ["Full score", "PDF parts"] },
  { title: "Uptown Funk", modified: "2025-11-16", assets: ["PDF parts"] }
].sort((a, b) => a.title.localeCompare(b.title));

const songs = works.map((work) => work.title);

const partOptions = {
  "Alto saxophone (E-flat)": ["Alto saxophone 1 (E-flat)", "Alto saxophone 2 (E-flat)", "Alto saxophone 3/4 (E-flat)"],
  "Baritone saxophone (E-flat)": ["Baritone saxophone (E-flat)"],
  "Clarinet (B-flat)": ["Clarinet 1 (B-flat)", "Clarinet 2 (B-flat)", "Clarinet 3/4 (B-flat)"],
  "Drums / percussion": ["Drum set", "Snare drum", "Bass drum", "Cymbals", "Congas", "Tenor drums", "All percussion"],
  "Euphonium / baritone (B-flat)": ["Euphonium (B-flat)", "Euphonium treble clef (B-flat)", "Euphonium bass clef (B-flat)", "Baritone horn (B-flat)"],
  Flute: ["Flute 1", "Flute 2"],
  "French horn (F)": ["French horn (F)"],
  "Mellophone (F)": ["Mellophone (F)"],
  Melodica: ["Melodica"],
  "Soprano saxophone (B-flat)": ["Soprano saxophone (B-flat)"],
  "Tenor saxophone (B-flat)": ["Tenor saxophone (B-flat)"],
  "Trombone (B-flat)": ["Trombone 1 (B-flat)", "Trombone 2 (B-flat)", "Bass trombone (B-flat)"],
  "Trumpet (B-flat)": ["Trumpet 1 (B-flat)", "Trumpet 2 (B-flat)", "Trumpet 3 (B-flat)", "Trumpet 4 (B-flat)"],
  "Tuba / sousaphone (B-flat)": ["Tuba (B-flat)", "Sousaphone (B-flat)"]
};

const members = [
  { name: "David Stern", instrument: "Drum / Leader" },
  { name: "Tracy Bender", instrument: "Saxophone" },
  { name: "Rickey Barnett", instrument: "TBD" },
  { name: "Curtis Price", instrument: "Saxophone" },
  { name: "Robert Coale", instrument: "TBD" },
  { name: "Lynne Burrows", instrument: "Harmonium" },
  { name: "Steve Buff", instrument: "Drums" },
  { name: "Jan Shannon", instrument: "TBD" },
  { name: "Siobhan Wright", instrument: "Cymbals" },
  { name: "Joe Greenheron", instrument: "TBD" },
  { name: "Mark Cassidy", instrument: "Drums" },
  { name: "Bob Tearse", instrument: "TBD" },
  { name: "Joseph Katzinger", instrument: "French horn (F)" },
  { name: "Bruce Dewing", instrument: "TBD" },
  { name: "Steve Tarr", instrument: "TBD" },
  { name: "Tabatha Heiber", instrument: "TBD" },
  { name: "Lance", instrument: "Trumpet (B-flat)" },
  { name: "Amy Petersen", instrument: "Trumpet (B-flat)" },
  { name: "Bruce Hanson", instrument: "Euphonium (B-flat)" },
  { name: "Gordon Bainbridge", instrument: "Tuba (B-flat)" },
  { name: "Mike Koss", instrument: "Flugelhorn (B-flat)" },
  { name: "John", instrument: "Soprano sax (B-flat)" },
  { name: "Cole", instrument: "Baritone sax (E-flat)" }
];

const juneConfirmedYes = [
  "David Stern",
  "Mark Cassidy",
  "Steve Buff",
  "Jan Shannon",
  "Bruce Hanson",
  "Amy Petersen",
  "Lynne Burrows",
  "Tracy Bender",
  "Joseph Katzinger",
  "John",
  "Bob Tearse",
  "Bruce Dewing",
  "Mike Koss"
];

const attendanceStates = {
  yes: "Confirmed yes",
  no: "Confirmed no",
  pending: "No response"
};

const gigs = [
  {
    id: "pride-picnic",
    name: "Pride Picnic @ The Whidbey Institute",
    date: "2026-06-06",
    displayDate: "Sat Jun 6, 2026",
    location: "The Whidbey Institute",
    address: "Clinton, WA",
    arrival: "TBD by gig leader",
    performance: "Event listing for June 6, 2026",
    notes: "PRIDE Picnic with Mutiny Bay Brass Band for the SW Pride event. Source: mutinybaybrassband.com.",
    confirmedYes: juneConfirmedYes,
    setList: [
      {
        name: "Set One",
        songs: ["Rock Anthem", "Iko Iko", "Get Lucky", "Funkin' it Up", "Jump in the Line", "Iron Man", "Montserrat", "Bella Ciao"]
      },
      {
        name: "Set Two",
        songs: ["Track Suit", "Thriller", "Matador", "Sail", "Hot to Go", "Moliendo Cafe", "Hava Negila"]
      }
    ]
  },
  {
    id: "coupeville-pride",
    name: "Coupeville Pride Parade",
    date: "2026-06-13",
    displayDate: "Sat Jun 13, 2026",
    location: "Coupeville Farmer's Market",
    address: "Coupeville, WA",
    arrival: "TBD by gig leader",
    performance: "Parade and program at 12:30 PM",
    notes: "Public event listing links to coupevillepride.org. Source: mutinybaybrassband.com.",
    setList: ["Shipping up to Boston", "Do Watcha Wanna", "Get Lucky", "Monster Mash", "Jump in the Line"]
  },
  {
    id: "south-whidbey-pride",
    name: "South Whidbey Pride Parade",
    date: "2026-06-20",
    displayDate: "Sat Jun 20, 2026",
    location: "South Whidbey Community Center and Downtown Langley",
    address: "Langley, WA",
    arrival: "TBD by gig leader",
    performance: "12:00 PM - 3:00 PM",
    notes: "Sample packet with confirmed roster and two-set performance order.",
    confirmedYes: juneConfirmedYes,
    setList: [
      {
        name: "Set One",
        songs: ["Rock Anthem", "Iko Iko", "Get Lucky", "Feel Like Funkin It Up", "Jump in the Line", "Iron Man", "Montserrat Serrat", "Bella Ciao"]
      },
      {
        name: "Set Two",
        songs: ["Track Suit By Bruce", "Thriller", "Matador", "SAIL (Meute)", "Hot to Go", "Moliendo Cafe", "Hava Negila"]
      }
    ]
  },
  {
    id: "freeland-library-family-festival",
    name: "Freeland Library Family Festival",
    date: "2026-06-27",
    displayDate: "Sat Jun 27, 2026",
    location: "Freeland Library",
    address: "5495 Harbor Ave, Freeland, WA 98249-1357",
    arrival: "TBD by gig leader",
    performance: "Event time TBD",
    notes: "Outdoor summer festival with ice cream from Sprinklz and live music. Source: mutinybaybrassband.com.",
    setList: ["Bad Guy", "Feel Like Funkin It Up", "Oye Como Va", "Rock Lobster", "Uptown Funk"]
  }
];

const state = {
  selectedSong: songs[0],
  selectedGigId: "south-whidbey-pride",
  selectedPart: partOptions["Alto saxophone (E-flat)"][0],
  printFormat: "letter",
  audio: {
    status: "paused",
    position: 0,
    duration: 156
  },
  search: "",
  returnViewId: "libraryView"
};

const elements = {
  instrument: document.querySelector("#instrumentSelect"),
  partField: document.querySelector(".part-field"),
  part: document.querySelector("#partSelect"),
  format: document.querySelector("#formatSelect"),
  songSearch: document.querySelector("#songSearch"),
  songList: document.querySelector("#songList"),
  songCount: document.querySelector("#songCount"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedMeta: document.querySelector("#selectedMeta"),
  assetTags: document.querySelector("#assetTags"),
  assetResult: document.querySelector("#assetResult"),
  assetResultTitle: document.querySelector("#assetResultTitle"),
  assetResultDetail: document.querySelector("#assetResultDetail"),
  sheetTitle: document.querySelector("#sheetTitle"),
  sheetFooter: document.querySelector("#sheetFooter"),
  scoreTitle: document.querySelector("#scoreTitle"),
  scoreMeta: document.querySelector("#scoreMeta"),
  scoreFormat: document.querySelector("#scoreFormatSelect"),
  scoreResult: document.querySelector("#scoreResult"),
  scoreResultTitle: document.querySelector("#scoreResultTitle"),
  scoreResultDetail: document.querySelector("#scoreResultDetail"),
  scorePage: document.querySelector("#scorePage"),
  scoreSheetTitle: document.querySelector("#scoreSheetTitle"),
  scoreSheetFooter: document.querySelector("#scoreSheetFooter"),
  practiceTrack: document.querySelector("#practiceTrack"),
  audioTracks: document.querySelectorAll("[data-audio-track], #practiceTrack"),
  audioToggleButtons: document.querySelectorAll("[data-audio-toggle]"),
  audioPlayButtons: document.querySelectorAll("[data-audio-play]"),
  audioPauseButtons: document.querySelectorAll("[data-audio-pause]"),
  audioRestartButtons: document.querySelectorAll("[data-audio-restart]"),
  audioProgressBars: document.querySelectorAll("[data-audio-progress]"),
  audioTimes: document.querySelectorAll("[data-audio-time]"),
  gigSelect: document.querySelector("#gigSelect"),
  calendarLabel: document.querySelector("#calendarLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  gigName: document.querySelector("#gigName"),
  gigWhen: document.querySelector("#gigWhen"),
  gigLocation: document.querySelector("#gigLocation"),
  gigArrival: document.querySelector("#gigArrival"),
  gigNotes: document.querySelector("#gigNotes"),
  packetResult: document.querySelector("#packetResult"),
  packetResultTitle: document.querySelector("#packetResultTitle"),
  packetResultDetail: document.querySelector("#packetResultDetail"),
  setList: document.querySelector("#setList"),
  attendanceSummary: document.querySelector("#attendanceSummary"),
  attendanceList: document.querySelector("#attendanceList"),
  toast: document.querySelector("#toast"),
  downloadPartButton: document.querySelector("#downloadPartButton"),
  downloadMuseScoreButton: document.querySelector("#downloadMuseScoreButton"),
  downloadGigButton: document.querySelector("#downloadGigButton"),
  performanceViewButton: document.querySelector("#performanceViewButton"),
  printScoreButton: document.querySelector("#printScoreButton"),
  backToCollectionButton: document.querySelector("#backToCollectionButton")
};

let audioTimer = null;

function currentGig() {
  return gigs.find((gig) => gig.id === state.selectedGigId) || gigs[0];
}

function countSetListSongs(gig) {
  if (Array.isArray(gig.setList?.[0]?.songs)) {
    return gig.setList.reduce((count, section) => count + section.songs.length, 0);
  }
  return gig.setList?.length || 0;
}

function setListSections(gig) {
  return Array.isArray(gig.setList?.[0]?.songs)
    ? gig.setList
    : [{ name: "Gig Music", songs: gig.setList || [] }];
}

function attendanceForGig(gig) {
  const confirmedYes = new Set(gig.confirmedYes || []);
  const confirmedNo = new Set(gig.confirmedNo || []);
  return members.map((member) => {
    let status = "pending";
    if (confirmedYes.has(member.name)) status = "yes";
    if (confirmedNo.has(member.name)) status = "no";
    return { ...member, status };
  });
}

function countConfirmed(gig) {
  return attendanceForGig(gig).filter((person) => person.status === "yes").length;
}

function formatLabel() {
  const labels = {
    letter: "8.5 x 11",
    lyre: "7 x 5 lyre"
  };
  return labels[state.printFormat] || labels.letter;
}

function formatUseNote() {
  if (state.printFormat === "lyre") {
    return "7 x 5 lyre card";
  }
  return "8.5 x 11 PDF or image for paper and iPad use";
}

function fileSafeLabel(value) {
  return value
    .toLowerCase()
    .replace(/\(b-flat\)/g, "bb")
    .replace(/\(e-flat\)/g, "eb")
    .replace(/\(f\)/g, "f")
    .replace(/8\.5 x 11/g, "letter")
    .replace(/7 x 5 lyre/g, "7x5-lyre")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function partDownloadFilename(workTitle) {
  return `mbbb_${fileSafeLabel(workTitle)}_${fileSafeLabel(state.selectedPart)}_${fileSafeLabel(formatLabel())}.pdf`;
}

function museScoreDownloadFilename(workTitle) {
  return `mbbb_${fileSafeLabel(workTitle)}_full-score.mscz`;
}

function gigPacketFilename(gig) {
  return `mbbb_${gig.date}_${fileSafeLabel(gig.name)}_${fileSafeLabel(state.selectedPart)}_${fileSafeLabel(formatLabel())}.zip`;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function partsForInstrument() {
  return partOptions[elements.instrument.value] || [elements.instrument.value];
}

function ensureSelectedPart() {
  const choices = partsForInstrument();
  if (!choices.includes(state.selectedPart)) {
    state.selectedPart = choices[0];
  }
}

function renderPartOptions() {
  ensureSelectedPart();
  const choices = partsForInstrument();
  elements.part.innerHTML = "";
  choices.forEach((part) => {
    const option = document.createElement("option");
    option.value = part;
    option.textContent = part;
    elements.part.append(option);
  });
  elements.part.value = state.selectedPart;
  elements.partField.hidden = choices.length < 2;
}

function displayAssets(work) {
  return ["PDF", "MuseScore", "Audio"];
}

function setActionResult(title, detail) {
  elements.assetResultTitle.textContent = title;
  elements.assetResultDetail.textContent = detail;
  elements.assetResult.classList.add("active");
}

function setScoreResult(title, detail) {
  elements.scoreResultTitle.textContent = title;
  elements.scoreResultDetail.textContent = detail;
  elements.scoreResult.classList.add("active");
}

function setPacketResult(title, detail) {
  elements.packetResultTitle.textContent = title;
  elements.packetResultDetail.textContent = detail;
  elements.packetResult.classList.add("active");
}

function openMusicAction(label, workTitle) {
  const previousSong = state.selectedSong;
  const sourceViewId = activeViewId();
  selectSong(workTitle);
  if (label === "Audio" && previousSong !== state.selectedSong) {
    state.audio.position = 0;
  }
  renderSongs();
  renderSelectedSong();
  renderScoreView();
  if (document.querySelector("#gigView").classList.contains("active")) {
    renderGig();
  }

  const part = state.selectedPart;
  const format = formatLabel();
  const actions = {
    Score: {
      title: `Score opened: ${state.selectedSong}`,
      detail: `Showing the full score entry for ${state.selectedSong}. Player packet remains set to ${part}.`
    },
    Audio: {
      title: `Playing audio: ${state.selectedSong}`,
      detail: `Practice MP3 is playing in the embedded player for ${state.selectedSong}.`
    },
    Part: {
      title: `PDF ready: ${state.selectedSong}`,
      detail: `${part} is ready in ${format} format as ${partDownloadFilename(state.selectedSong)}.`
    },
    MuseScore: {
      title: `MuseScore ready: ${state.selectedSong}`,
      detail: `Full score source is ready as ${museScoreDownloadFilename(state.selectedSong)}.`
    },
    Performance: {
      title: `Score view opened: ${state.selectedSong}`,
      detail: `${part} is shown in performance view using ${formatUseNote()}.`
    }
  };
  const action = actions[label] || actions.Part;
  if (label === "Performance" || label === "Score") {
    showScoreView(sourceViewId);
    setScoreResult(action.title, action.detail);
  }
  if (label === "Audio") {
    playAudio();
  }
  setActionResult(action.title, action.detail);
  showToast(action.title);
}

function renderMusicTile(workTitle, options = {}) {
  const item = document.createElement("div");
  item.className = `song-item${workTitle === state.selectedSong ? " active" : ""}`;

  const titleWrap = document.createElement("div");
  titleWrap.className = "song-title-block";

  if (options.indexLabel) {
    const index = document.createElement("span");
    index.className = "song-index";
    index.textContent = options.indexLabel;
    titleWrap.append(index);
  }

  const titleButton = document.createElement("button");
  titleButton.type = "button";
  titleButton.className = "song-main";
  titleButton.textContent = workTitle;
  titleButton.addEventListener("click", () => {
    state.selectedSong = workTitle;
    renderSongs();
    renderSelectedSong();
    if (options.context === "gig") {
      setPacketResult(
        `Selected from set list: ${workTitle}`,
        `${state.selectedPart} is selected. Use Score for the page view, Audio for the embedded player, or download the full packet if needed.`
      );
    }
  });
  titleWrap.append(titleButton);

  const actions = document.createElement("div");
  actions.className = "song-actions";
  ["Score", "Audio"].forEach((label) => {
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = label;
    action.addEventListener("click", () => {
      openMusicAction(label, workTitle);
    });
    actions.append(action);
  });

  item.append(titleWrap, actions);
  return item;
}

function renderSongs() {
  const query = state.search.trim().toLowerCase();
  const filtered = works.filter((work) => work.title.toLowerCase().includes(query));
  elements.songCount.textContent = `${filtered.length} of ${works.length} titles with music links`;
  elements.songList.innerHTML = "";

  filtered.forEach((work) => {
    elements.songList.append(renderMusicTile(work.title));
  });
}

function renderSelectedSong() {
  const work = works.find((item) => item.title === state.selectedSong) || works[0];
  ensureSelectedPart();
  renderPartOptions();
  elements.selectedTitle.textContent = state.selectedSong;
  elements.selectedMeta.textContent = `${state.selectedPart} - ${formatLabel()} format - modified ${work.modified}`;
  elements.sheetTitle.textContent = state.selectedSong;
  elements.sheetFooter.textContent = `${state.selectedPart} - ${formatLabel()}`;
  elements.downloadPartButton.textContent = "Download PDF";
  elements.downloadMuseScoreButton.textContent = "Download MuseScore";
  elements.assetTags.innerHTML = "";
  [...displayAssets(work), "Performance score view"].forEach((asset) => {
    const tag = document.createElement("span");
    tag.textContent = asset;
    elements.assetTags.append(tag);
  });
  renderScoreView();
}

function renderScoreView() {
  const work = works.find((item) => item.title === state.selectedSong) || works[0];
  elements.scoreTitle.textContent = state.selectedSong;
  elements.scoreMeta.textContent = `${state.selectedPart} - ${formatUseNote()} - modified ${work.modified}`;
  elements.scoreSheetTitle.textContent = state.selectedSong;
  elements.scoreSheetFooter.textContent = `${state.selectedPart} - ${formatLabel()}`;
  elements.practiceTrack.textContent = `${state.selectedSong} - practice MP3 - ${state.audio.status}`;
  elements.scorePage.classList.toggle("letter-format", state.printFormat === "letter");
  elements.scorePage.classList.toggle("lyre-format", state.printFormat === "lyre");
  elements.scoreFormat.value = state.printFormat;
  elements.format.value = state.printFormat;
  renderAudioPlayer();
}

function renderGigOptions() {
  elements.gigSelect.innerHTML = "";
  gigs.forEach((gig) => {
    const option = document.createElement("option");
    option.value = gig.id;
    option.textContent = `${gig.displayDate} - ${gig.name}`;
    elements.gigSelect.append(option);
  });
  elements.gigSelect.value = state.selectedGigId;
}

function renderCalendar() {
  const selected = currentGig();
  const [selectedYear, selectedMonth] = selected.date.split("-").map(Number);
  const monthGigs = gigs.filter((gig) => {
    const [year, month] = gig.date.split("-").map(Number);
    return year === selectedYear && month === selectedMonth;
  });
  const gigDays = new Map(monthGigs.map((gig) => [Number(gig.date.slice(-2)), gig]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthDate = new Date(selectedYear, selectedMonth - 1, 1);
  const monthName = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const firstDayOffset = monthDate.getDay();
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();

  elements.calendarLabel.textContent = `${monthName} - highlighted dates have packets ready.`;
  elements.calendarGrid.innerHTML = "";

  weekdays.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "calendar-cell header";
    cell.textContent = day;
    elements.calendarGrid.append(cell);
  });

  for (let blank = 0; blank < firstDayOffset; blank += 1) {
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    cell.setAttribute("aria-hidden", "true");
    elements.calendarGrid.append(cell);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const gig = gigDays.get(day);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `calendar-cell${gig ? " gig-day" : ""}${gig?.id === selected.id ? " active" : ""}`;
    cell.textContent = day;
    cell.disabled = !gig;
    if (gig) {
      cell.setAttribute("aria-label", `${gig.name}, June ${day}`);
      cell.addEventListener("click", () => {
        state.selectedGigId = gig.id;
        elements.gigSelect.value = gig.id;
        renderGig();
      });
    }
    elements.calendarGrid.append(cell);
  }
}

function renderGig() {
  const gig = currentGig();
  ensureSelectedPart();
  elements.gigName.textContent = gig.name;
  elements.gigWhen.textContent = `${gig.displayDate} - ${gig.performance}`;
  elements.gigLocation.textContent = `${gig.location} - ${gig.address}`;
  elements.gigArrival.textContent = gig.arrival;
  elements.gigNotes.textContent = gig.notes;
  elements.setList.innerHTML = "";

  let songIndex = 1;

  setListSections(gig).forEach((section) => {
    const sectionBlock = document.createElement("section");
    sectionBlock.className = "set-section";
    const title = document.createElement("h4");
    title.textContent = section.name;
    const list = document.createElement("div");
    list.className = "song-list gig-song-list";

    section.songs.forEach((song) => {
      list.append(renderMusicTile(song, {
        context: "gig",
        indexLabel: `${songIndex}.`
      }));
      songIndex += 1;
    });

    sectionBlock.append(title, list);
    elements.setList.append(sectionBlock);
  });

  renderAttendance(gig);
  setPacketResult(
    `Packet selected: ${gig.name}`,
    `${state.selectedPart} packet is ready to review for ${gig.displayDate}.`
  );
  renderCalendar();
}

function showView(viewId) {
  document.querySelectorAll(".tab").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewId);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.body.classList.toggle("performance-mode", viewId === "scoreView");
  if (viewId === "scoreView") {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
  }
  if (viewId === "scoreView") {
    renderScoreView();
  }
}

function activeViewId() {
  const activeView = document.querySelector(".view.active");
  return activeView?.id === "gigView" ? "gigView" : "libraryView";
}

function showScoreView(sourceViewId = activeViewId()) {
  state.returnViewId = sourceViewId === "gigView" ? "gigView" : "libraryView";
  showView("scoreView");
}

function exitScoreView() {
  if (!document.querySelector("#scoreView").classList.contains("active")) {
    return;
  }
  showView(state.returnViewId);
}

function renderAudioPlayer() {
  const percent = Math.min(100, Math.max(0, (state.audio.position / state.audio.duration) * 100));
  elements.audioProgressBars.forEach((bar) => {
    bar.style.width = `${percent}%`;
  });
  elements.audioTimes.forEach((time) => {
    time.textContent = `${formatTime(state.audio.position)} / ${formatTime(state.audio.duration)}`;
  });
  elements.audioToggleButtons.forEach((button) => {
    const isPlaying = state.audio.status === "playing";
    button.textContent = isPlaying ? "Pause" : "Play";
    button.setAttribute("aria-label", isPlaying ? "Pause practice audio" : "Play practice audio");
  });
  elements.audioPlayButtons.forEach((button) => {
    button.disabled = state.audio.status === "playing";
  });
  elements.audioPauseButtons.forEach((button) => {
    button.disabled = state.audio.status !== "playing";
  });
  elements.audioTracks.forEach((track) => {
    track.textContent = `${state.selectedSong} - practice MP3 - ${state.audio.status}`;
  });
}

function stopAudioTimer() {
  if (audioTimer) {
    window.clearInterval(audioTimer);
    audioTimer = null;
  }
}

function playAudio() {
  state.audio.status = "playing";
  stopAudioTimer();
  audioTimer = window.setInterval(() => {
    state.audio.position = Math.min(state.audio.duration, state.audio.position + 1);
    if (state.audio.position >= state.audio.duration) {
      state.audio.status = "paused";
      stopAudioTimer();
    }
    renderAudioPlayer();
  }, 1000);
  renderAudioPlayer();
  setActionResult(
    `Playing audio: ${state.selectedSong}`,
    `Practice MP3 is playing in the embedded player for ${state.selectedPart}.`
  );
  setScoreResult(
    `Playing audio: ${state.selectedSong}`,
    `Practice MP3 is playing alongside ${state.selectedPart}.`
  );
  showToast(`Playing audio: ${state.selectedSong}`);
}

function pauseAudio() {
  state.audio.status = "paused";
  stopAudioTimer();
  renderAudioPlayer();
  setActionResult(
    `Audio paused: ${state.selectedSong}`,
    `Playback is paused at ${formatTime(state.audio.position)}.`
  );
  setScoreResult(
    `Audio paused: ${state.selectedSong}`,
    `Playback is paused at ${formatTime(state.audio.position)}.`
  );
}

function toggleAudio() {
  if (state.audio.status === "playing") {
    pauseAudio();
  } else {
    playAudio();
  }
}

function restartAudio() {
  state.audio.position = 0;
  renderAudioPlayer();
  setActionResult(
    `Audio reset: ${state.selectedSong}`,
    `Playback is back at the beginning of the song.`
  );
  setScoreResult(
    `Audio reset: ${state.selectedSong}`,
    `Playback is back at the beginning of the song.`
  );
}

function renderAttendance(gig) {
  const roster = attendanceForGig(gig);
  const counts = {
    yes: roster.filter((person) => person.status === "yes").length,
    pending: roster.filter((person) => person.status === "pending").length,
    no: roster.filter((person) => person.status === "no").length
  };

  elements.attendanceSummary.innerHTML = "";
  ["yes", "pending", "no"].forEach((status) => {
    const chip = document.createElement("span");
    chip.className = `attendance-count ${status}`;
    chip.textContent = `${attendanceStates[status]}: ${counts[status]}`;
    elements.attendanceSummary.append(chip);
  });

  elements.attendanceList.innerHTML = "";
  roster.forEach((person) => {
    const item = document.createElement("div");
    item.className = `attendance-card ${person.status}`;
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = person.name;
    const instrument = document.createElement("span");
    instrument.textContent = person.instrument;
    const status = document.createElement("span");
    status.className = `status-pill ${person.status}`;
    status.textContent = attendanceStates[person.status];

    details.append(name, instrument);
    item.append(details, status);
    elements.attendanceList.append(item);
  });

  if (!roster.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No roster responses attached to this sample gig yet.";
    elements.attendanceList.append(empty);
  }
}

function selectSong(song) {
  const matchingWork = works.find((work) => work.title === song);
  if (matchingWork) {
    state.selectedSong = matchingWork.title;
  } else {
    state.selectedSong = song;
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    showView(tab.dataset.view);
  });
});

elements.songSearch.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderSongs();
});

elements.instrument.addEventListener("change", () => {
  ensureSelectedPart();
  renderSelectedSong();
  renderGig();
});

elements.part.addEventListener("change", (event) => {
  state.selectedPart = event.target.value;
  renderSelectedSong();
  renderGig();
});

function updatePrintFormat(value) {
  state.printFormat = value === "lyre" ? "lyre" : "letter";
  elements.format.value = state.printFormat;
  elements.scoreFormat.value = state.printFormat;
  renderSelectedSong();
  renderGig();
}

elements.format.addEventListener("change", (event) => {
  updatePrintFormat(event.target.value);
});

elements.scoreFormat.addEventListener("change", (event) => {
  updatePrintFormat(event.target.value);
  setScoreResult(
    `Print format selected: ${formatLabel()}`,
    state.printFormat === "lyre"
      ? "This score is sized for 7 x 5 lyre cards."
      : "This score is sized as 8.5 x 11 for printing or iPad display."
  );
});

elements.gigSelect.addEventListener("change", (event) => {
  state.selectedGigId = event.target.value;
  renderGig();
});

elements.downloadPartButton.addEventListener("click", () => {
  openMusicAction("Part", state.selectedSong);
});

elements.downloadMuseScoreButton.addEventListener("click", () => {
  openMusicAction("MuseScore", state.selectedSong);
});

elements.downloadGigButton.addEventListener("click", () => {
  const gig = currentGig();
  setPacketResult(
    `Packet opened: ${gig.name}`,
    `${state.selectedPart} packet is assembled as ${gigPacketFilename(gig)} with ${countSetListSongs(gig)} tunes and ${countConfirmed(gig)} confirmed players.`
  );
  showToast(`Packet opened: ${gig.name}`);
});

elements.performanceViewButton.addEventListener("click", () => {
  openMusicAction("Performance", state.selectedSong);
});

elements.printScoreButton.addEventListener("click", () => {
  setScoreResult(
    `Print ready: ${state.selectedSong}`,
    `${state.selectedPart} is ready as ${formatUseNote()}.`
  );
  showToast(`Print ready: ${formatLabel()}`);
});

elements.backToCollectionButton.addEventListener("click", () => {
  exitScoreView();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    exitScoreView();
  }
});

elements.audioPlayButtons.forEach((button) => {
  button.addEventListener("click", playAudio);
});
elements.audioPauseButtons.forEach((button) => {
  button.addEventListener("click", pauseAudio);
});
elements.audioToggleButtons.forEach((button) => {
  button.addEventListener("click", toggleAudio);
});
elements.audioRestartButtons.forEach((button) => {
  button.addEventListener("click", restartAudio);
});

renderSongs();
renderSelectedSong();
renderGigOptions();
renderGig();
