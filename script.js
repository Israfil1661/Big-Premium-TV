const PLAYLIST_URLS = [
    'https://raw.githubusercontent.com/imShakil/tvlink/refs/heads/main/iptv.m3u8',
    'https://github.com/abusaeeidx/Mrgify-BDIX-IPTV/raw/main/playlist.m3u',
    'https://lupael.github.io/IPTV/world.m3u',
    'https://tvn.todayvisionbd.com/Tsports-3/index.m3u8',
    'http://banglavu.top:8080/get.php?username=8767644&password=8767644&type=m3u_plus&output=ts'
];

let channels = [];
let currentIndex = 0;
let hls = null;

const video = document.getElementById('videoPlayer');
const loadingOverlay = document.getElementById('loadingOverlay');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const channelListBtn = document.getElementById('channelListBtn');
const channelListPanel = document.getElementById('channelListPanel');
const channelListItems = document.getElementById('channelListItems');
const fitModeBtn = document.getElementById('fitModeBtn');
const unmuteBtn = document.getElementById('unmuteBtn');
const scanBtn = document.getElementById('scanBtn');
const scanStatus = document.getElementById('scanStatus');
const topControls = document.getElementById('topControls');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const volumeRange = document.getElementById('volumeRange');
const brightnessRange = document.getElementById('brightnessRange');
const autoSizeCheck = document.getElementById('autoSizeCheck');
const widthInput = document.getElementById('widthInput');
const heightInput = document.getElementById('heightInput');
const rotateInput = document.getElementById('rotateInput');
const rotateMinusBtn = document.getElementById('rotateMinusBtn');
const rotatePlusBtn = document.getElementById('rotatePlusBtn');
const zoomInput = document.getElementById('zoomInput');
const zoomMinusBtn = document.getElementById('zoomMinusBtn');
const zoomPlusBtn = document.getElementById('zoomPlusBtn');
const borderInput = document.getElementById('borderInput');
const borderMinusBtn = document.getElementById('borderMinusBtn');
const borderPlusBtn = document.getElementById('borderPlusBtn');

const STORAGE_KEY = 'iptv_working_channels';
const DEFAULT_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<rect width="40" height="40" rx="6" fill="#5a3f28"/>' +
    '<text x="50%" y="55%" font-size="18" text-anchor="middle" fill="#f5e9d8" font-family="sans-serif">📺</text>' +
    '</svg>'
);

async function fetchAllPlaylistChannels() {
    const fetched = [];
    for (const url of PLAYLIST_URLS) {
        try {
            const response = await fetch(url);
            const text = await response.text();
            fetched.push(...parseM3U(text, fetched.length));
        } catch (e) {
            console.error("লিংক লোড করতে সমস্যা:", url);
        }
    }
    return fetched;
}

// #EXTINF লাইন থেকে tvg-logo ও চ্যানেলের নাম বের করে, তার পরের লাইনের url এর সাথে যুক্ত করে
function parseM3U(content, startCount = 0) {
    const lines = content.split('\n').map(l => l.trim());
    const result = [];
    let pendingLogo = null;
    let pendingName = null;

    lines.forEach(line => {
        if (line.startsWith('#EXTINF')) {
            const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
            pendingLogo = logoMatch ? logoMatch[1] : null;
            const nameMatch = line.split(',');
            pendingName = nameMatch.length > 1 ? nameMatch[nameMatch.length - 1].trim() : null;
        } else if (line.startsWith('http')) {
            result.push({
                url: line,
                name: pendingName || ("Channel " + (startCount + result.length + 1)),
                logo: pendingLogo || ''
            });
            pendingLogo = null;
            pendingName = null;
        }
    });

    return result;
}

function saveChannelsToStorage(chs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chs));
    } catch (e) {
        console.error("চ্যানেল সেভ করতে সমস্যা:", e);
    }
}

function loadChannelsFromStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        return null;
    }
}

// একটি চ্যানেল সত্যিই চলে কিনা টেস্ট করে (offscreen video দিয়ে)
function testChannel(url, timeoutMs = 8000) {
    return new Promise(resolve => {
        let settled = false;
        const tempVideo = document.createElement('video');
        tempVideo.muted = true;
        tempVideo.style.display = 'none';
        document.body.appendChild(tempVideo);
        let tempHls = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (tempHls) { try { tempHls.destroy(); } catch (e) {} }
            tempVideo.remove();
            resolve(result);
        };

        const timer = setTimeout(() => finish(false), timeoutMs);

        if (window.Hls && Hls.isSupported()) {
            tempHls = new Hls();
            tempHls.loadSource(url);
            tempHls.attachMedia(tempVideo);
            tempHls.on(Hls.Events.MANIFEST_PARSED, () => finish(true));
            tempHls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) finish(false);
            });
        } else if (tempVideo.canPlayType('application/vnd.apple.mpegurl')) {
            tempVideo.src = url;
            tempVideo.addEventListener('loadedmetadata', () => finish(true), { once: true });
            tempVideo.addEventListener('error', () => finish(false), { once: true });
        } else {
            finish(false);
        }
    });
}

// সব চ্যানেল স্ক্যান করে শুধু কার্যকরগুলো রাখে — বর্তমান চলমান চ্যানেল না থামিয়ে ব্যাকগ্রাউন্ডে
async function scanChannels() {
    scanBtn.disabled = true;
    scanBtn.textContent = '⏳ স্ক্যান হচ্ছে...';

    // এখন যেটা চলছে সেটা মনে রাখি, যাতে স্ক্যান শেষে সেটাই চালু থাকে
    const currentUrl = channels[currentIndex] ? channels[currentIndex].url : null;
    const wasEmpty = channels.length === 0;

    scanStatus.textContent = `প্লেলিস্ট লোড হচ্ছে...`;
    const candidates = await fetchAllPlaylistChannels();
    const total = candidates.length;
    let checked = 0;
    const working = [];

    scanStatus.textContent = `স্ক্যান হচ্ছে (ব্যাকগ্রাউন্ডে): 0/${total}`;

    const concurrency = 6;
    let cursor = 0;

    async function worker() {
        while (cursor < candidates.length) {
            const myIndex = cursor++;
            const ch = candidates[myIndex];
            const ok = await testChannel(ch.url);
            checked++;
            scanStatus.textContent = `স্ক্যান হচ্ছে (ব্যাকগ্রাউন্ডে): ${checked}/${total}`;
            if (ok) working.push(ch);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));

    channels = working;
    saveChannelsToStorage(channels);

    // বর্তমান চলমান চ্যানেলটা নতুন লিস্টে কোথায় পড়লো সেটা খুঁজে ইনডেক্স ঠিক করি,
    // ভিডিও প্লেব্যাক স্পর্শ না করেই (তাই TV চলতেই থাকবে)
    if (currentUrl) {
        const idx = channels.findIndex(ch => ch.url === currentUrl);
        if (idx !== -1) {
            currentIndex = idx;
        }
    }

    buildChannelList();
    updateActiveChannelInList();
    scanBtn.disabled = false;
    scanBtn.textContent = '🔍 চ্যানেল স্ক্যান';
    scanStatus.textContent = `মোট ${channels.length}টি চ্যানেল চলছে`;

    if (channels.length === 0) {
        showLoading("কোনো কার্যকর চ্যানেল পাওয়া যায়নি");
    } else if (wasEmpty) {
        // আগে কিছুই চলছিল না (প্রথমবার স্ক্যান ব্যর্থ হয়ে থাকলে) — এখন প্রথমটা চালাই
        playChannel(0);
    }
}

async function initPlayer() {
    const saved = loadChannelsFromStorage();
    if (saved && saved.length > 0) {
        channels = saved;
        buildChannelList();
        scanStatus.textContent = `মোট ${channels.length}টি চ্যানেল (আগের স্ক্যান থেকে)`;
        playChannel(0);
    } else {
        // প্রথমবার: টেস্ট না করেই পুরো লিস্ট দেখাও (৫০০০+ চ্যানেলে স্ক্যান করলে অনেক সময় লাগে)
        showLoading("চ্যানেল লিস্ট লোড হচ্ছে...");
        const all = await fetchAllPlaylistChannels();
        channels = all;
        buildChannelList();
        scanStatus.textContent = `মোট ${channels.length}টি চ্যানেল (স্ক্যান করা হয়নি)`;
        if (channels.length > 0) {
            playChannel(0);
        } else {
            showLoading("কোনো চ্যানেল পাওয়া যায়নি");
        }
    }
}

function buildChannelList() {
    channelListItems.innerHTML = '';
    channels.forEach((ch, idx) => {
        const li = document.createElement('li');
        li.dataset.index = idx;
        li.style.setProperty('--i', Math.min(idx, 25));

        const logoSrc = ch.logo && ch.logo.trim() ? ch.logo : DEFAULT_LOGO;

        li.innerHTML = `
            <span class="ch-serial">${idx + 1}.</span>
            <img class="ch-logo" src="${logoSrc}" alt="" onerror="this.onerror=null;this.src='${DEFAULT_LOGO}';">
            <span class="ch-name">${ch.name}</span>
        `;
        li.addEventListener('click', () => {
            primeAudio();
            playChannel(idx);
        });
        channelListItems.appendChild(li);
    });
}

function updateActiveChannelInList() {
    const items = channelListItems.querySelectorAll('li');
    items.forEach(li => {
        li.classList.toggle('active', Number(li.dataset.index) === currentIndex);
    });
}

function showLoading(msg) {
    loadingOverlay.innerHTML = `
        <div class="spinner"></div>
        <div class="overlay-text">${msg}</div>
    `;
    loadingOverlay.style.display = 'flex';
}

// চ্যানেল চলছে না — স্যাটেলাইট ও ডিশের সংযোগ বিচ্ছিন্ন হওয়ার অ্যানিমেশন
function showSignalError(msg) {
    loadingOverlay.innerHTML = `
        <div class="satellite-anim glitching">
            <svg viewBox="0 0 100 100" width="100" height="100">
                <!-- সংযোগ লাইন: ডিশ থেকে স্যাটেলাইট পর্যন্ত -->
                <line class="signal-line" x1="35" y1="55" x2="74" y2="24" stroke="#f0c98a" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 5"/>

                <!-- ডিশের ছাতা -->
                <path d="M15 80 Q35 46 55 80" fill="none" stroke="#d9a55a" stroke-width="4" stroke-linecap="round"/>
                <line x1="35" y1="55" x2="35" y2="80" stroke="#d9a55a" stroke-width="4" stroke-linecap="round"/>
                <circle cx="35" cy="80" r="3.5" fill="#d9a55a"/>

                <!-- স্যাটেলাইট -->
                <g class="satellite-icon">
                    <rect x="67" y="18" width="14" height="9" rx="2" fill="#d9a55a"/>
                    <rect x="55" y="14" width="10" height="17" fill="#f0c98a" opacity="0.85"/>
                    <rect x="83" y="14" width="10" height="17" fill="#f0c98a" opacity="0.85"/>
                    <line x1="74" y1="18" x2="74" y2="10" stroke="#d9a55a" stroke-width="2" stroke-linecap="round"/>
                </g>

                <!-- বিচ্ছিন্ন চিহ্ন -->
                <g class="disconnect-x">
                    <line x1="47" y1="32" x2="62" y2="47" stroke="#e5534b" stroke-width="4" stroke-linecap="round"/>
                    <line x1="62" y1="32" x2="47" y2="47" stroke="#e5534b" stroke-width="4" stroke-linecap="round"/>
                </g>
            </svg>
        </div>
        <div class="overlay-text error-text">${msg}</div>
    `;
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}

// ব্যবহারকারীর ট্যাপ/ক্লিকের ঠিক মধ্যেই ভিডিও এলিমেন্টকে "আনলক" করার চেষ্টা
// (বিশেষত iOS Safari-তে, যাতে পরের অ্যাসিঙ্ক প্লে সাউন্ড সহ চলে)
function primeAudio() {
    video.muted = false;
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
}

// ব্রাউজার autoplay ব্লক করলে muted করে আবার চেষ্টা করে, যাতে ভিডিও নিজে থেকেই চলা শুরু করে
function attemptPlay() {
    const p = video.play();
    if (p && typeof p.catch === 'function') {
        p.catch(() => {
            video.muted = true;
            video.play().then(() => {
                unmuteBtn.classList.remove('hidden');
            }).catch(() => {
                // এতেও ব্যর্থ হলে ব্যবহারকারীকে ম্যানুয়ালি প্লে করতে হবে
                playPauseBtn.textContent = '▶';
                playPauseBtn.classList.remove('is-playing');
            });
        });
    }
}

function playChannel(index) {
    if (channels.length === 0) return;
    currentIndex = (index + channels.length) % channels.length;
    const channel = channels[currentIndex];
    updateActiveChannelInList();
    unmuteBtn.classList.add('hidden');

    showLoading("লোড হচ্ছে...");

    if (hls) {
        hls.destroy();
        hls = null;
    }

    if (window.Hls && Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(channel.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            hideLoading();
            attemptPlay();
            playPauseBtn.textContent = '⏸';
            playPauseBtn.classList.add('is-playing');
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.error("HLS fatal error:", data);
                showSignalError("স্যাটেলাইট থেকে বিচ্ছিন্ন");
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = channel.url;
        video.addEventListener('loadedmetadata', () => {
            hideLoading();
            attemptPlay();
            playPauseBtn.textContent = '⏸';
            playPauseBtn.classList.add('is-playing');
        }, { once: true });
    } else {
        showLoading("আপনার ব্রাউজার এই স্ট্রিম সাপোর্ট করে না");
    }
}

const videoWrapper = document.getElementById('videoWrapper');
const playerFrame = document.getElementById('playerFrame');

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        if (playerFrame.requestFullscreen) {
            playerFrame.requestFullscreen();
        } else if (playerFrame.webkitRequestFullscreen) {
            playerFrame.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

videoWrapper.addEventListener('dblclick', toggleFullscreen);

// ভিডিওতে সাধারণ ট্যাপ/ক্লিক করলেও মিউট থাকলে আনমিউট হয়ে যাবে
videoWrapper.addEventListener('click', () => {
    if (video.muted) {
        video.muted = false;
        unmuteBtn.classList.add('hidden');
    }
});

// --- অটো-হাইড কন্ট্রোল বার (১০ সেকেন্ড নিষ্ক্রিয় থাকলে) ---
const controlsBar = document.getElementById('controls');
let hideTimer = null;

function showControls() {
    controlsBar.classList.remove('hidden');
    topControls.classList.remove('hidden');
    applyBorder(); // ব্যবহারকারীর সেট করা বর্ডার ফিরিয়ে আনি
    resetHideTimer();
}

function hideControls() {
    controlsBar.classList.add('hidden');
    topControls.classList.add('hidden');
    video.style.padding = '0'; // নিষ্ক্রিয় অবস্থায় বর্ডার হাইড, ভিডিও পুরো জায়গা নেবে
}

function resetHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideControls, 10000);
}

// মাউস মুভ, টাচ, বা ক্লিক করলে কন্ট্রোল আবার দেখাবে
['mousemove', 'touchstart', 'click'].forEach(evt => {
    playerFrame.addEventListener(evt, showControls);
});

resetHideTimer();

playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
        video.play();
        playPauseBtn.textContent = '⏸';
        playPauseBtn.classList.add('is-playing');
    } else {
        video.pause();
        playPauseBtn.textContent = '▶';
        playPauseBtn.classList.remove('is-playing');
    }
});

prevBtn.addEventListener('click', () => {
    primeAudio();
    playChannel(currentIndex - 1);
});

nextBtn.addEventListener('click', () => {
    primeAudio();
    playChannel(currentIndex + 1);
});

channelListBtn.addEventListener('click', () => {
    videoWrapper.classList.toggle('list-open');
});

// --- ভিডিও ফিট মোড: Fit -> Crop -> 100% -> Stretch -> (আবার Fit) ---
const fitModes = [
    { key: 'contain', label: '⛶ Fit' },
    { key: 'cover', label: '⛶ Crop' },
    { key: 'none', label: '⛶ 100%' },
    { key: 'fill', label: '⛶ Stretch' }
];
let fitModeIndex = 0;

function applyFitMode() {
    const mode = fitModes[fitModeIndex];
    video.style.objectFit = mode.key;
    fitModeBtn.textContent = mode.label;
}

fitModeBtn.addEventListener('click', () => {
    fitModeIndex = (fitModeIndex + 1) % fitModes.length;
    applyFitMode();
});

applyFitMode();

scanBtn.addEventListener('click', () => {
    scanChannels();
});

// --- সেটিংস প্যানেল ---
settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
});

// ভলিউম
volumeRange.addEventListener('input', () => {
    video.volume = Number(volumeRange.value) / 100;
    video.muted = false;
    unmuteBtn.classList.add('hidden');
});

unmuteBtn.addEventListener('click', () => {
    video.muted = false;
    unmuteBtn.classList.add('hidden');
});

// ব্রাইটনেস
brightnessRange.addEventListener('input', () => {
    video.style.filter = `brightness(${brightnessRange.value}%)`;
});

// স্ক্রিন সাইজ: অটো বা ম্যানুয়াল
autoSizeCheck.addEventListener('change', () => {
    if (autoSizeCheck.checked) {
        widthInput.disabled = true;
        heightInput.disabled = true;
        video.style.width = '100%';
        video.style.height = '100%';
    } else {
        widthInput.disabled = false;
        heightInput.disabled = false;
        applyCustomSize();
    }
});

function applyCustomSize() {
    const w = Number(widthInput.value);
    const h = Number(heightInput.value);
    if (w > 0) video.style.width = w + 'px';
    if (h > 0) video.style.height = h + 'px';
}

widthInput.addEventListener('input', applyCustomSize);
heightInput.addEventListener('input', applyCustomSize);

// স্ক্রিন রোটেট + জুম — দুটো একসাথে মিলিয়ে transform এ বসানো হয়
function applyTransform() {
    const deg = Number(rotateInput.value) || 0;
    const zoom = Number(zoomInput.value) || 100;
    video.style.transform = `rotate(${deg}deg) scale(${zoom / 100})`;
}

rotateInput.addEventListener('input', applyTransform);

rotateMinusBtn.addEventListener('click', () => {
    rotateInput.value = (Number(rotateInput.value) || 0) - 90;
    applyTransform();
});

rotatePlusBtn.addEventListener('click', () => {
    rotateInput.value = (Number(rotateInput.value) || 0) + 90;
    applyTransform();
});

// জুম — ভিডিওকে দুই দিকেই সমান হারে বড়/ছোট করে, তাই ফুলস্ক্রিনে কালো বর্ডার (letterbox)
// থাকলে জুম করে সহজেই পুরো স্ক্রিন ভরে ফেলা যাবে
zoomInput.addEventListener('input', applyTransform);

zoomMinusBtn.addEventListener('click', () => {
    zoomInput.value = Math.max(50, (Number(zoomInput.value) || 100) - 10);
    applyTransform();
});

zoomPlusBtn.addEventListener('click', () => {
    zoomInput.value = Math.min(400, (Number(zoomInput.value) || 100) + 10);
    applyTransform();
});

// ভিডিও বর্ডার — ভিডিওর চারপাশে কালো ফ্রেমের পুরুত্ব
function applyBorder() {
    const px = Math.max(0, Number(borderInput.value) || 0);
    video.style.padding = `${px}px`;
}

borderInput.addEventListener('input', applyBorder);

borderMinusBtn.addEventListener('click', () => {
    borderInput.value = Math.max(0, (Number(borderInput.value) || 0) - 2);
    applyBorder();
});

borderPlusBtn.addEventListener('click', () => {
    borderInput.value = (Number(borderInput.value) || 0) + 2;
    applyBorder();
});

// --- ল্যান্ডিং / পাওয়ার-অন ---
const landingScreen = document.getElementById('landingScreen');
const powerBtn = document.getElementById('powerBtn');
const crtFlash = document.getElementById('crtFlash');
const stage = document.getElementById('stage');

powerBtn.addEventListener('click', () => {
    powerBtn.classList.add('pressed');
    crtFlash.classList.add('active');
    landingScreen.classList.add('hide');
    stage.classList.add('on');
    primeAudio();

    // ভিডিও প্লে-কে সরাসরি ইউজারের ক্লিকের সাথেই (synchronously) কল করা হচ্ছে,
    // যাতে ব্রাউজার এটাকে autoplay হিসেবে ব্লক না করে
    initPlayer();

    setTimeout(() => {
        crtFlash.classList.remove('active');
    }, 800);
});
