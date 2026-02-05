// --- 1. KONFIGURATION & GLOBALE VARIABLEN ---
const firebaseConfig = {
    apiKey: "AIzaSyANKW1Lu8nnZu2fY1S6HcUdn9pzT6-GRJY", 
    authDomain: "cupid-connection-ce199.firebaseapp.com",
    projectId: "cupid-connection-ce199",
    storageBucket: "cupid-connection-ce199.firebasestorage.app",
    messagingSenderId: "535809095665",
    appId: "1:535809095665:web:75b927448b09d23faeb650",
    measurementId: "G-BG2LW0BTDZ"
};

// Variablen global definieren
var db, auth, storage, rtdb, analytics;

// --- 2. INITIALISIERUNG ---
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth(); 
    storage = firebase.storage();
    rtdb = firebase.database(); 
    analytics = firebase.analytics();
} catch(e) { 
    console.error("Firebase Init Error:", e); 
}

// --- 3. APP LOGIK ---
const app = {
    data: { 
        posts: [], 
        orders: [], 
        totalCount: 0 
    },
    currentUser: null,
    html5QrCode: null,
    activeOrderId: null,
    isVip: false,
    listenersStarted: false,

    priceList: {
        "Brief": 0.00, 
        "Brief + Keks": 1.00, 
        "Brief + Hariborose": 1.00,
        "Brief + Papierrose": 2.00, 
        "Brief + Hariborose + Keks": 2.00,
        "Brief + Papierrose + Keks": 2.50, 
        "Brief + Keks + Hariborose + Papierrose": 3.50
    },

    // --- STARTUP LOGIK ---
    init: () => {
        const loadingEl = document.getElementById('auth-loading');
        const loginContainer = document.getElementById('login-container');
        const overlay = document.getElementById('auth-overlay');
        
        loadingEl.classList.remove('hidden');
        loginContainer.classList.add('hidden');

        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
            .catch(e => console.warn("Persistence Error:", e));

        auth.getRedirectResult().then((result) => {
            if (result.user) console.log("Redirect Login erkannt.");
        }).catch(error => console.log("Kein Redirect Return:", error));

        auth.onAuthStateChanged((user) => {
            if (user) {
                app.handleLoginSuccess(user);
                if (!app.listenersStarted) {
                    app.startDatabaseListeners();
                }
            } else {
                loadingEl.classList.add('hidden');
                loginContainer.classList.remove('hidden');
                overlay.classList.remove('hidden');
                app.listenersStarted = false;
            }
        });

        app.updateCountdown();
        setInterval(app.updateCountdown, 1000);
        app.setVibe('classic');
    },

    // --- LOGIN ---
    loginWithMicrosoft: () => {
        const provider = new firebase.auth.OAuthProvider('microsoft.com');
        provider.setCustomParameters({ 
            prompt: 'select_account', 
            tenant: 'f7bb63a9-5ed7-4a21-b43a-3f684ec4938b' 
        });

        const ua = navigator.userAgent || navigator.vendor || window.opera;
        const isInApp = (ua.indexOf("Instagram") > -1) || (ua.indexOf("FBAN") > -1) || (ua.indexOf("FBAV") > -1) || (ua.indexOf("TikTok") > -1);

        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('auth-loading').classList.remove('hidden');

        if (isInApp) {
            auth.signInWithRedirect(provider).catch(err => {
                alert("Fehler: " + err.message);
                location.reload(); 
            });
        } else {
            auth.signInWithPopup(provider).catch(error => {
                console.error("Popup Fehler:", error);
                document.getElementById('login-container').classList.remove('hidden');
                document.getElementById('auth-loading').classList.add('hidden');
                if (error.code !== 'auth/popup-closed-by-user') {
                    alert("Login Fehler: " + error.message);
                }
            });
        }
    },

    handleLoginSuccess: (user) => {
        const email = user.email.toLowerCase();
        if (!email.endsWith('@europagym.at') && email !== 'admin@europagym.at') { 
            auth.signOut(); 
            alert("Nur @europagym.at Adressen erlaubt.");
            return; 
        }
        
        app.currentUser = email;
        sessionStorage.setItem('userEmail', app.currentUser);

        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('safety-banner').classList.remove('hidden');
        
        let displayName = user.displayName || email.split('@')[0];
        if (email === 'admin@europagym.at') {
            displayName = "Admin";
            app.nav('admin');
        }

        document.getElementById('current-user').innerText = displayName;
        document.getElementById('user-initials').innerText = displayName.charAt(0).toUpperCase();
        document.getElementById('profile-email').innerText = email;
        
        if(!app.listenersStarted) app.showToast("Erfolgreich eingeloggt 🚀");
    },

    // --- LISTENER ---
    startDatabaseListeners: () => {
        if (app.listenersStarted) return;
        app.listenersStarted = true;

        db.collection("posts").orderBy("timestamp", "desc").onSnapshot(snapshot => {
            app.data.posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            app.renderFeed();
            if(app.currentUser === 'admin@europagym.at') app.renderModQueue(); 
        });

        let ordersQuery = db.collection("orders");
        if (app.currentUser !== 'admin@europagym.at') {
            ordersQuery = ordersQuery.where("sender", "==", app.currentUser);
        }
        
        ordersQuery.onSnapshot(snapshot => {
            app.data.orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            if (app.currentUser === 'admin@europagym.at') {
                app.data.orders.sort((a,b) => {
                    if (a.isVip && !b.isVip) return -1;
                    if (!a.isVip && b.isVip) return 1;
                    return b.timestamp - a.timestamp;
                });
                app.renderOrders(); 
            }
            app.renderMyOrders(); 
            app.checkVipStatus();
        });

        db.collection("metadata").doc("stats").onSnapshot(doc => {
            if (doc.exists) { 
                app.data.totalCount = doc.data().count || 0; 
                app.updateStats(); 
            }
        });
        
        app.initPresence();
    },

    initPresence: () => {
        const onlineRef = rtdb.ref('.info/connected');
        onlineRef.on('value', (snapshot) => {
            if (snapshot.val() === true && app.currentUser) {
                if (app.currentUser === 'admin@europagym.at') return;
                const myId = app.currentUser.replace(/\./g, '_').replace(/@/g, '_');
                const userStatusRef = rtdb.ref('/presence/' + myId);
                userStatusRef.onDisconnect().remove();
                userStatusRef.set({ 
                    email: app.currentUser, 
                    last_seen: firebase.database.ServerValue.TIMESTAMP 
                });
            }
        });
        rtdb.ref('/presence').on('value', (snapshot) => {
            const count = snapshot.numChildren() || 0;
            const indicator = document.getElementById('online-indicator'); 
            if(indicator) indicator.innerText = `${count} Online`;
        });
    },

    checkVipStatus: () => {
        const hasPaid = (app.data.orders || []).some(o => o.priceAtOrder > 0 && o.sender === app.currentUser);
        app.isVip = hasPaid;
        const headerBadge = document.getElementById('vip-badge-header'); 
        
        if (app.isVip) {
            if(headerBadge) headerBadge.classList.remove('hidden');
        } else {
            if(headerBadge) headerBadge.classList.add('hidden');
        }
    },

    // --- ZIELE & GOLD STATUS ---
    updateStats: () => {
        const total = app.data.totalCount || 0;
        const bigCount = document.getElementById('total-count-big');
        if(bigCount) bigCount.innerText = total;
        
        // Max Ziel auf 200 gesetzt
        const maxGoal = 200; 
        let percentage = (total / maxGoal) * 100;
        if(percentage > 100) percentage = 100;
        
        const bar = document.getElementById('progress-bar');
        
        // Gold Status nur unter 50 Bestellungen (Early Bird / VIP Phase)
        if (total < 50) {
            if(bar) bar.classList.add('is-gold');
            if(bigCount) { 
                bigCount.classList.add('gold-text-effect'); 
                bigCount.classList.remove('text-brand-accent'); 
            }
        } else {
            if(bar) bar.classList.remove('is-gold');
            if(bigCount) { 
                bigCount.classList.remove('gold-text-effect'); 
                bigCount.classList.add('text-brand-accent'); 
            }
        }
        
        if(bar) bar.style.width = percentage + '%';
        app.updateTotal(); 
    },

    // --- NAVIGATION ---
    logout: () => { 
        sessionStorage.removeItem('userEmail'); 
        auth.signOut().then(() => location.reload()); 
    },
    
    nav: (id) => {
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        
        document.querySelectorAll('nav button').forEach(b => { 
            b.classList.remove('active-nav', 'text-white'); 
            b.classList.add('text-gray-500'); 
        });
        
        const btn = document.getElementById('nav-' + id);
        if(btn) { 
            btn.classList.remove('text-gray-500'); 
            btn.classList.add('active-nav', 'text-white'); 
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // --- ADMIN ---
    checkAdminAccess: () => {
        document.getElementById('admin-auth-modal').classList.remove('hidden');
        document.getElementById('admin-user').value = "admin@europagym.at";
    },

    adminLogin: async () => {
        const email = document.getElementById('admin-user').value;
        const pass = document.getElementById('admin-pass').value;
        try {
            await auth.signInWithEmailAndPassword(email, pass);
            document.getElementById('admin-auth-modal').classList.add('hidden');
            setTimeout(() => location.reload(), 500); 
        } catch (error) { 
            alert("Login fehlgeschlagen: " + error.message); 
        }
    },

    adminTab: (tab) => {
        document.querySelectorAll('.admin-view').forEach(v => v.classList.add('hidden'));
        document.getElementById('admin-' + tab).classList.remove('hidden');
        
        document.querySelectorAll('.admin-tab-btn').forEach(b => { 
            b.classList.remove('bg-white/10', 'text-white'); 
            b.classList.add('text-gray-500'); 
        });
        
        const btn = document.getElementById('t-' + tab);
        if(btn) { 
            btn.classList.add('bg-white/10', 'text-white'); 
            btn.classList.remove('text-gray-500'); 
        }
        
        if(tab === 'mod') app.renderModQueue();
        if(tab === 'orders') app.renderOrders();
    },

    // --- BESTELLUNG ---
    submitOrder: async () => {
        const id = 'ORD-' + Math.floor(Math.random() * 90000 + 10000);
        const recipient = document.getElementById('order-recipient').value;
        const grade = document.getElementById('order-grade').value;
        const room = document.getElementById('order-room').value;
        const message = document.getElementById('order-message').value;
        const selectedBtn = document.querySelector('input[name="product"]:checked');
        const fileInput = document.getElementById('order-image'); 

        if (!recipient || !grade || !room || !message) { 
            alert("Bitte alle Felder ausfüllen."); 
            return; 
        }

        let currentPrice = app.priceList[selectedBtn.value] || 0;
        if (app.isVip && currentPrice > 0) currentPrice *= 0.85; 

        const submitBtn = document.querySelector('#order-form button[type="submit"]');
        submitBtn.disabled = true;

        try {
            let imageUrl = null;
            if (app.isVip && fileInput && fileInput.files.length > 0) {
                submitBtn.innerText = "Lade Bild...";
                const file = fileInput.files[0];
                const storageRef = storage.ref(`vip_uploads/${id}_${file.name}`);
                await storageRef.put(file);
                imageUrl = await storageRef.getDownloadURL();
            }

            const newOrder = { 
                recipient, 
                grade, 
                room, 
                product: selectedBtn.value, 
                message, 
                vibe: document.getElementById('order-vibe').value, 
                sender: app.currentUser, 
                status: 'Bestellt', 
                isVip: app.isVip, 
                priceAtOrder: currentPrice, 
                timestamp: Date.now(), 
                vipImage: imageUrl 
            };

            await db.collection("orders").doc(id).set(newOrder);
            await db.collection("metadata").doc("stats").set({ 
                count: firebase.firestore.FieldValue.increment(1) 
            }, { merge: true });

            document.getElementById('qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${id}&color=7c3aed&bgcolor=ffffff`;
            document.getElementById('qr-order-id').innerText = id;
            document.getElementById('qr-summary').innerHTML = `<div class="flex justify-between"><span>Produkt:</span> <span class="text-white font-bold">${newOrder.product}</span></div>`;
            document.getElementById('qr-modal').classList.remove('hidden');
            document.getElementById('order-form').reset();
            app.updateTotal(); 

        } catch (err) { 
            alert("Fehler bei Bestellung: " + err.message); 
        } finally { 
            submitBtn.disabled = false; 
            submitBtn.innerText = "Bestellen & Code generieren"; 
        }
    },

    // --- PHASEN TEXTE (200er Skala) ---
    getPhaseName: () => {
        const count = app.data.totalCount || 0;
        if (count < 50) return "Start: 0% Rabatt";
        if (count < 100) return "Phase 1: -5% Rabatt 📉";
        if (count < 150) return "Phase 2: -10% Rabatt 📉";
        if (count < 200) return "Phase 3: -15% Rabatt 📉";
        return "ZIEL: 20% RABATT 🔥";
    },

    updateTotal: () => {
        const selected = document.querySelector('input[name="product"]:checked');
        if (!selected) return;
        let price = app.priceList[selected.value] || 0;
        if (app.isVip && price > 0) price = price * 0.85; 
        document.getElementById('order-total').innerText = (app.isVip ? "👑 " : "") + (price === 0 ? "Gratis" : price.toFixed(2).replace('.', ',') + '€');
        document.getElementById('price-phase-badge').innerText = app.getPhaseName();
    },

    setVibe: (vibe) => {
        document.getElementById('order-vibe').value = vibe;
        document.querySelectorAll('.vibe-btn').forEach(btn => {
            if(btn.dataset.vibe === vibe) btn.classList.replace('text-gray-400', 'text-brand-accent');
            else btn.classList.replace('text-brand-accent', 'text-gray-400');
        });
    },

    // --- WALL & FEED (UPDATED) ---
    renderFeed: (filter = 'all') => {
        const container = document.getElementById('feed-container');
        if (!container) return;
        container.innerHTML = '';
        
        let posts = (app.data.posts || []).filter(p => p.approved);
        
        if(filter === 'new') {
            posts.sort((a,b) => b.timestamp - a.timestamp); 
        } else {
            posts.sort((a,b) => b.hearts - a.hearts); 
        }

        posts.forEach(post => {
            // LOGIK: Wann ist ein Post "Hot"? (Hier ab 5 Likes)
            const isHot = (post.hearts >= 5); 
            const hotClass = isHot ? 'post-hot' : 'border-white/5';
            const hotIcon = isHot ? '<span class="text-orange-500 ml-2 text-[10px] animate-pulse font-bold"><i class="fa-solid fa-fire"></i> TRENDING</span>' : '';

            // LOGIK: VIP Spotlight
            const vipClass = post.isVip ? 'vip-post' : '';
            const vipBadge = post.isVip ? '<span class="text-[#ffd700] ml-2 text-[10px] font-bold"><i class="fa-solid fa-crown"></i> VIP</span>' : '';

            container.innerHTML += `
                <div class="glass-card p-6 rounded-2xl mb-4 border transition-all duration-300 ${hotClass} ${vipClass}">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center">
                            <span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Anonym</span>
                            ${vipBadge}
                            ${hotIcon}
                        </div>
                    </div>
                    <p class="text-gray-200 text-sm mb-4 leading-relaxed font-medium">"${post.text}"</p>
                    <div class="flex justify-between items-center pt-3 border-t border-white/5">
                        <span class="text-[9px] text-gray-600">Cupid Wall</span>
                        <button onclick="app.heartPost('${post.id}', this)" class="text-gray-500 hover:text-pink-500 transition-all flex items-center gap-1.5 group">
                            <i class="fa-solid fa-heart transition-transform group-hover:scale-110"></i> 
                            <span class="text-xs font-bold hearts-count transition-colors">${post.hearts || 0}</span>
                        </button>
                    </div>
                </div>`;
        });
    },

    // --- NEU: VISUELLES JUICE (Animation & Sofort-Feedback) ---
    heartPost: (id, btn) => {
        // 1. Visuelles Feedback (Sofort)
        const icon = btn.querySelector('i');
        const countSpan = btn.querySelector('.hearts-count');
        
        // Explosion-Klasse hinzufügen
        icon.classList.add('heart-pop');
        countSpan.classList.add('text-pink-500');

        // Zähler optisch hochzählen
        let current = parseInt(countSpan.innerText);
        countSpan.innerText = current + 1;

        // Klasse nach Animation wieder entfernen
        setTimeout(() => icon.classList.remove('heart-pop'), 500);

        // 2. Datenbank Update
        db.collection("posts").doc(id).update({ 
            hearts: firebase.firestore.FieldValue.increment(1) 
        })
        .then(() => console.log("Geliked!"))
        .catch(err => {
            console.error("Like Fehler:", err);
            // Falls Fehler: Zähler zurücksetzen
            countSpan.innerText = current; 
        });
    },

    submitPost: () => {
        const txt = document.getElementById('new-post-content').value;
        if(!txt.trim()) return;
        
        db.collection("posts").add({ 
            text: txt, 
            hearts: 0, 
            approved: false, 
            timestamp: Date.now(), 
            author: app.currentUser,
            isVip: app.isVip // WICHTIG: Status für Spotlight speichern!
        })
        .then(() => { 
            document.getElementById('new-post-content').value = ''; 
            document.getElementById('post-modal').classList.add('hidden'); 
            app.showToast("Wartet auf Freigabe"); 
        });
    },

    filterWall: (type) => {
        document.querySelectorAll('#wall button').forEach(btn => btn.classList.remove('active-filter'));
        document.getElementById('filter-' + type).classList.add('active-filter');
        app.renderFeed(type);
    },

    // --- ADMIN VIEWS ---
    renderMyOrders: () => {
        const list = document.getElementById('my-orders-list');
        const mine = (app.data.orders || []).filter(o => o.sender === app.currentUser).sort((a,b) => b.timestamp - a.timestamp);
        
        list.innerHTML = mine.map(o => `
            <div class="glass-card p-6 rounded-[2rem] mb-4">
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <div class="text-[10px] text-brand-primary font-mono">${o.id}</div>
                        <div class="font-bold text-white">${o.recipient}</div>
                    </div>
                    <div class="text-brand-accent text-[10px] uppercase font-bold">${o.status}</div>
                </div>
            </div>`).join('') || '<div class="text-center text-gray-500">Keine Bestellungen.</div>';
    },

    renderOrders: () => {
        const list = document.getElementById('orders-list');
        
        list.innerHTML = (app.data.orders || []).map(o => {
            const vipClass = o.isVip ? 'vip-order-highlight' : '';
            const priceDisplay = o.priceAtOrder ? `${o.priceAtOrder.toFixed(2).replace('.', ',')}€` : 'Gratis';
            const vipIcon = o.isVip ? '<i class="fa-solid fa-crown text-yellow-500 mr-1"></i>' : '';

            return `
            <div class="glass-card p-4 rounded-xl text-xs mb-2 ${vipClass}">
                <div class="flex justify-between font-bold mb-1">
                    <span>${vipIcon} ${o.id}</span>
                    <span class="${o.status === 'Geliefert' ? 'text-green-500' : 'text-gray-400'}">${o.status}</span>
                </div>
                <div class="text-white font-medium mb-1">${o.product} für <span class="text-brand-accent">${o.recipient}</span></div>
                <div class="flex justify-between items-center text-[10px] text-gray-500 mb-2">
                    <span>${o.grade} / ${o.room}</span>
                    <span class="text-white font-bold">${priceDisplay}</span>
                </div>
                <button onclick="app.showOrderDetails('${o.id}')" class="w-full py-2 bg-white/5 hover:bg-white/10 rounded transition">Öffnen</button>
            </div>`;
        }).join('');
    },

    renderModQueue: () => {
        const q = document.getElementById('mod-queue');
        const pending = (app.data.posts || []).filter(p => !p.approved);
        q.innerHTML = pending.map(p => `
            <div class="glass-card p-4 flex justify-between items-center mb-2">
                <p class="text-xs w-2/3">"${p.text}"</p>
                <div class="flex gap-2">
                    <button onclick="app.modAction('${p.id}', true)" class="text-green-500 p-2 hover:bg-green-500/10 rounded">✔</button>
                    <button onclick="app.modAction('${p.id}', false)" class="text-red-500 p-2 hover:bg-red-500/10 rounded">✘</button>
                </div>
            </div>`).join('') || '<div class="text-center text-gray-500 text-xs">Alles erledigt.</div>';
    },

    modAction: (id, approve) => approve ? db.collection("posts").doc(id).update({ approved: true }) : db.collection("posts").doc(id).delete(),

    startScanner: () => {
        document.getElementById('reader').classList.remove('hidden');
        app.html5QrCode = new Html5Qrcode("reader");
        app.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (txt) => {
            app.html5QrCode.stop().then(() => { 
                document.getElementById('reader').classList.add('hidden'); 
                app.showOrderDetails(txt); 
            });
        }).catch(err => alert("Kamera Fehler: " + err));
    },

    showOrderDetails: (id) => {
        const order = app.data.orders.find(o => o.id === id);
        if (!order) {
            app.showToast("Bestellung nicht gefunden!");
            return;
        }
        app.activeOrderId = id;
        document.getElementById('det-id').innerText = id;
        document.getElementById('det-recipient').innerText = order.recipient;
        document.getElementById('det-room').innerText = `${order.room} (${order.grade})`;
        document.getElementById('det-product').innerText = order.product;
        document.getElementById('det-message').innerText = order.message;
        
        const detailCard = document.querySelector('#active-order-view .glass-card');
        if(order.isVip) {
            detailCard.classList.add('vip-frame'); 
            document.getElementById('det-product').innerHTML = `${order.product} <span class="text-yellow-500 ml-2"><i class="fa-solid fa-crown"></i> VIP</span>`;
        } else {
            detailCard.classList.remove('vip-frame');
        }

        document.getElementById('active-order-view').classList.remove('hidden');
    },

    updateStatus: (newStatus) => {
        db.collection("orders").doc(app.activeOrderId).update({ status: newStatus })
        .then(() => { 
            app.showToast(newStatus); 
            document.getElementById('active-order-view').classList.add('hidden'); 
        });
    },

    showToast: (msg) => {
        const t = document.getElementById('toast');
        document.getElementById('toast-msg').innerText = msg;
        t.classList.remove('translate-x-[150%]');
        setTimeout(() => t.classList.add('translate-x-[150%]'), 3000);
    },

    updateCountdown: () => {
        const diff = new Date('February 14, 2026 00:00:00').getTime() - new Date().getTime();
        if(diff > 0) {
            document.getElementById('days').innerText = String(Math.floor(diff / (1000 * 60 * 60 * 24))).padStart(2, '0');
            document.getElementById('hours').innerText = String(Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
            document.getElementById('minutes').innerText = String(Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
            document.getElementById('seconds').innerText = String(Math.floor((diff % (1000 * 60)) / 1000)).padStart(2, '0');
        }
    }
};

document.addEventListener('DOMContentLoaded', app.init);