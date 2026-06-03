const works = [
  { title: "Bad Guy", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Baile Inolvidable", source: "file", modified: "2026-02-17", assets: ["PDF parts"] },
  { title: "Bella Ciao", source: "file", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Bumper to Bumper", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Dancing Queen", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Do Watcha Wanna", source: "folder", modified: "2025-11-16", assets: ["Part folder", "Score"] },
  { title: "Feel Like Funkin It Up", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "For What It's Worth", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Free Bird in Thirty Seconds", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Freedom", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Get Lucky", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Gnosienne #1", source: "file", modified: "2026-01-22", assets: ["PDF parts"] },
  { title: "Hava Negila", source: "folder", modified: "2025-11-14", assets: ["Part folder", "Score"] },
  { title: "Hell", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Hot to Go", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Iko Iko", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Iron Man", source: "folder", modified: "2025-11-14", assets: ["Part folder", "Score"] },
  { title: "It's Raining Men", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "It's Your Thing", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Jingle Bell Rock", source: "folder", modified: "2025-11-14", assets: ["Part folder", "Score"] },
  { title: "Jump in the Line", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Lorenzo in Sicilia (Temptation)", source: "file", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Matador", source: "file", modified: "2026-01-07", assets: ["PDF parts"] },
  { title: "Moliendo Cafe", source: "file", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Money - Pink Floyd", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Monster Mash", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Montero Road", source: "folder", modified: "2025-11-16", assets: ["Part folder", "Score"] },
  { title: "Montserrat Serrat", source: "folder", modified: "2025-11-16", assets: ["Part folder", "Score"] },
  { title: "Mr. Brightside", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Oye Como Va", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Ring of Fire", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Rock Anthem", source: "folder", modified: "2025-11-16", assets: ["Part folder", "Score"] },
  { title: "Rock Lobster", source: "folder", modified: "2025-11-16", assets: ["Part folder", "Score"] },
  { title: "SAIL (Meute)", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "SAT", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Shipping up to Boston", source: "file", modified: "2026-02-02", assets: ["PDF parts"] },
  { title: "Soulful Strut", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Stay Human", source: "folder", modified: "2025-11-16", assets: ["Part folder", "Score"] },
  { title: "Sweet Dreams", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Thriller", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Track Suit By Bruce", source: "file", modified: "2025-11-16", assets: ["PDF parts"] },
  { title: "Unholy Score", source: "file", modified: "2026-05-31", assets: ["Full score", "PDF parts"] },
  { title: "Uptown Funk", source: "file", modified: "2025-11-16", assets: ["PDF parts"] }
].sort((a, b) => a.title.localeCompare(b.title));

const songs = works.map((work) => work.title);

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
    setList: ["Hot to Go", "Dancing Queen", "Iko Iko", "Sweet Dreams", "Uptown Funk"]
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
    notes: "South Whidbey Pride Parade and Festival. Source: mutinybaybrassband.com.",
    setList: ["Soulful Strut", "Moliendo Cafe", "Bella Ciao", "Ring of Fire", "Rock Lobster"]
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
  selectedGigId: gigs[0].id,
  search: ""
};

const elements = {
  instrument: document.querySelector("#instrumentSelect"),
  format: document.querySelector("#formatSelect"),
  songSearch: document.querySelector("#songSearch"),
  songList: document.querySelector("#songList"),
  songCount: document.querySelector("#songCount"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedMeta: document.querySelector("#selectedMeta"),
  assetTags: document.querySelector("#assetTags"),
  sheetTitle: document.querySelector("#sheetTitle"),
  sheetFooter: document.querySelector("#sheetFooter"),
  gigSelect: document.querySelector("#gigSelect"),
  calendarLabel: document.querySelector("#calendarLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  gigName: document.querySelector("#gigName"),
  gigWhen: document.querySelector("#gigWhen"),
  gigLocation: document.querySelector("#gigLocation"),
  gigArrival: document.querySelector("#gigArrival"),
  gigNotes: document.querySelector("#gigNotes"),
  setList: document.querySelector("#setList"),
  toast: document.querySelector("#toast"),
  downloadPartButton: document.querySelector("#downloadPartButton"),
  downloadGigButton: document.querySelector("#downloadGigButton"),
  previewAudioButton: document.querySelector("#previewAudioButton"),
  tabletViewButton: document.querySelector("#tabletViewButton")
};

function currentGig() {
  return gigs.find((gig) => gig.id === state.selectedGigId) || gigs[0];
}

function formatLabel() {
  const labels = {
    tablet: "iPad / tablet",
    letter: "8.5 x 11",
    lyre: "7 x 5 lyre"
  };
  return labels[elements.format.value] || labels.tablet;
}

function renderSongs() {
  const query = state.search.trim().toLowerCase();
  const filtered = works.filter((work) => work.title.toLowerCase().includes(query));
  elements.songCount.textContent = `${filtered.length} of ${works.length} titles from the shared Drive folder`;
  elements.songList.innerHTML = "";

  filtered.forEach((work) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `song-button${work.title === state.selectedSong ? " active" : ""}`;
    button.innerHTML = `<span>${work.title}</span><span class="song-index">${work.source}</span>`;
    button.addEventListener("click", () => {
      state.selectedSong = work.title;
      renderSongs();
      renderSelectedSong();
    });
    elements.songList.append(button);
  });
}

function renderSelectedSong() {
  const instrument = elements.instrument.value;
  const work = works.find((item) => item.title === state.selectedSong) || works[0];
  const isTablet = elements.format.value === "tablet";
  elements.selectedTitle.textContent = state.selectedSong;
  elements.selectedMeta.textContent = `${instrument} part - ${formatLabel()} format - source ${work.source}, modified ${work.modified}`;
  elements.sheetTitle.textContent = state.selectedSong;
  elements.sheetFooter.textContent = `Mock preview for ${instrument} - ${formatLabel()}`;
  document.body.classList.toggle("tablet-format", isTablet);
  elements.downloadPartButton.textContent = isTablet ? "Open Part" : "Download Part";
  elements.tabletViewButton.hidden = !isTablet;
  elements.assetTags.innerHTML = "";
  [...work.assets, "Practice audio TBD", ...(isTablet ? ["Offline-ready tablet view"] : [])].forEach((asset) => {
    const tag = document.createElement("span");
    tag.textContent = asset;
    elements.assetTags.append(tag);
  });
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
  const instrument = elements.instrument.value;
  elements.gigName.textContent = gig.name;
  elements.gigWhen.textContent = `${gig.displayDate} - ${gig.performance}`;
  elements.gigLocation.textContent = `${gig.location} - ${gig.address}`;
  elements.gigArrival.textContent = gig.arrival;
  elements.gigNotes.textContent = gig.notes;
  elements.setList.innerHTML = "";

  gig.setList.forEach((song) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = song;
    button.addEventListener("click", () => {
      state.selectedSong = song;
      document.querySelector('[data-view="libraryView"]').click();
      renderSongs();
      renderSelectedSong();
    });
    item.append(button, ` - ${instrument} part`);
    elements.setList.append(item);
  });

  renderCalendar();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.view}`).classList.add("active");
  });
});

elements.songSearch.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderSongs();
});

elements.instrument.addEventListener("change", () => {
  renderSelectedSong();
  renderGig();
});

elements.format.addEventListener("change", renderSelectedSong);

elements.gigSelect.addEventListener("change", (event) => {
  state.selectedGigId = event.target.value;
  renderGig();
});

elements.downloadPartButton.addEventListener("click", () => {
  showToast(`Mock download: ${state.selectedSong} for ${elements.instrument.value}, ${formatLabel()}`);
});

elements.downloadGigButton.addEventListener("click", () => {
  showToast(`Mock packet: ${currentGig().name} for ${elements.instrument.value}, ${formatLabel()}`);
});

elements.previewAudioButton.addEventListener("click", () => {
  showToast(`Mock audio preview: ${state.selectedSong}`);
});

elements.tabletViewButton.addEventListener("click", () => {
  showToast(`Mock tablet performance view: ${state.selectedSong}, swipe to advance pages`);
});

renderSongs();
renderSelectedSong();
renderGigOptions();
renderGig();
