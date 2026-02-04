// --- 1. KONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyANKW1Lu8nnZu2fY1S6HcUdn9pzT6-GRJY", 
    authDomain: "cupid-connection-ce199.firebaseapp.com",
    projectId: "cupid-connection-ce199",
    storageBucket: "cupid-connection-ce199.firebasestorage.app",
    messagingSenderId: "535809095665",
    appId: "1:535809095665:web:75b927448b09d23faeb650",
    measurementId: "G-BG2LW0BTDZ"
};

// --- 2. INITIALISIERUNG ---
try {
    firebase.initializeApp(firebaseConfig);
    var db = firebase.firestore();
    var auth = firebase.auth(); 
    var storage = firebase.storage();
    var rtdb = firebase.database(); 
    const analytics = firebase.analytics();
} catch(e) { console.error("Firebase Init Error:", e); }

// --- 3. APP LOGIK ---
const app = {
    data: { posts: [], orders: [], totalCount: 0 },
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

    init: async () => {
        // UI vorbereiten: Spinner zeigen, bis wir wissen, ob wer eingeloggt ist
        document.getElementById('auth-loading').classList.remove('hidden');
        document.getElementById('login-container').classList.add('hidden');

        // WICHTIG FÜR SAFARI/INSTAGRAM: Redirect-Ergebnis prüfen
        try {
            const result = await auth.getRedirectResult();
            if (result.user) {
                console.log("Erfolgreich via Redirect eingeloggt");
                app.handleLoginSuccess(result.user);
            }
        } catch (error) {
            console.error("Redirect Fehler:", error);
            if (error.code === 'auth/idpiframe-copy-indexeddb-scoped-to-origin') {
                console.log("Safari Privacy Blockade erkannt - versuche Fallback");
            }
        }

        // Auth-Status überwachen
        auth.onAuthStateChanged((user) => {
            if (user) {
                app.handleLoginSuccess(user);
                app.startDatabaseListeners();
            } else {
                document.getElementById('auth-overlay').classList.remove('hidden');
                document.getElementById('auth-loading').classList.add('hidden');
                document.getElementById('login-container').classList.remove('hidden');
            }
        });

        app.updateCountdown();
        setInterval(app.updateCountdown, 1000);
        app.setVibe('classic');
    },

    loginWithMicrosoft: async () => {
        const provider = new firebase.auth.OAuthProvider('microsoft.com');
        provider.setCustomParameters({
            prompt: 'select_account',
            tenant: 'f7bb63a9-5ed7-4a21-b43a-3f684ec4938b' 
        });

        try {
            // 1. Zwinge Firebase, den Login LOKAL zu speichern (hilft gegen "missing initial state")
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            
            document.getElementById('login-container').classList.add('hidden');
            document.getElementById('auth-loading').classList.remove('hidden');

            // 2. Nutze Redirect statt Popup (Überlebenswichtig für Instagram/Safari)
            await auth.signInWithRedirect(provider);
        } catch (error) {
            console.error("Login Fehler:", error);
            alert("Login konnte nicht gestartet werden: " + error.message);
            document.getElementById('login-container').classList.remove('hidden');
            document.getElementById('auth-loading').classList.add('hidden');
        }
    },

    handleLoginSuccess: (user) => {
        const email = user.email.toLowerCase();
        if (!email.endsWith('@europagym.at') && email !== 'admin@europagym.at') { 
            auth.signOut(); 
            alert("Nur @europagym.at erlaubt.");
            return; 
        }
        
        app.currentUser = email;
        sessionStorage.setItem('userEmail', app.currentUser);
        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('safety-banner').classList.remove('hidden');
        
        let displayName = user.displayName || email.split('@')[0];
        if (email === 'admin@europagym.at') displayName = "Admin";
        document.getElementById('current-user').innerText = displayName;
        document.getElementById('user-initials').innerText = displayName.charAt(0).toUpperCase();
        document.getElementById('profile-email').innerText = email;
        
        if(!app.listenersStarted) app.showToast("Erfolgreich eingeloggt 🚀");
    },

    // --- RESTLICHER CODE BLEIBT GLEICH (STATS, WALL, ORDERS ETC.) ---
    startDatabaseListeners: () => {
        if (app.listenersStarted) return;
        app.listenersStarted = true;
        db.collection("posts").orderBy("timestamp", "desc").onSnapshot(snapshot => {
            app.data.posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            app.renderFeed(); app.renderModQueue(); 
        });
        let ordersQuery = db.collection("orders");
        if (app.currentUser !== 'admin@europagym.at') ordersQuery = ordersQuery.where("sender", "==", app.currentUser);
        ordersQuery.onSnapshot(snapshot => {
            app.data.orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (app.currentUser === 'admin@europagym.at') {
                app.data.orders.sort((a,b) => b.timestamp - a.timestamp);
                app.renderOrders(); 
            }
            app.renderMyOrders(); app.checkVipStatus();
        });
        db.collection("metadata").doc("stats").onSnapshot(doc => {
            if (doc.exists) { app.data.totalCount = doc.data().count || 0; app.updateStats(); }
        });
        app.initPresence();
    },

    initPresence: () => {
        const onlineRef = rtdb.ref('.info/connected');
        onlineRef.on('value', (snapshot) => {
            if (snapshot.val() === true && app.currentUser) {
                const myId = app.currentUser.replace(/\./g, '_').replace(/@/g, '_');
                const userStatusRef = rtdb.ref('/presence/' + myId);
                userStatusRef.onDisconnect().remove();
                userStatusRef.set({ email: app.currentUser, last_seen: firebase.database.ServerValue.TIMESTAMP });
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
        if (app.isVip && headerBadge) headerBadge.classList.remove('hidden');
    },

    updateStats: () => {
        const total = app.data.totalCount || 0;
        const bigCount = document.getElementById('total-count-big');
        if(bigCount) bigCount.innerText = total;
        const maxGoal = 500; 
        let percentage = (total / maxGoal) * 100;
        if(percentage > 100) percentage = 100;
        const bar = document.getElementById('progress-bar');
        if (total < 100) bar.classList.add('is-gold'); else bar.classList.remove('is-gold');
        if(bar) bar.style.width = percentage + '%';
    },

    logout: () => { sessionStorage.removeItem('userEmail'); auth.signOut().then(() => location.reload()); },
    nav: (id) => {
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        document.querySelectorAll('nav button').forEach(b => { b.classList.remove('active-nav', 'text-white'); b.classList.add('text-gray-500'); });
        const btn = document.getElementById('nav-' + id);
        if(btn) { btn.classList.remove('text-gray-500'); btn.classList.add('active-nav', 'text-white'); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    checkAdminAccess: () => {
        document.getElementById('admin-auth-modal').classList.remove('hidden');
        document.getElementById('admin-user').value = "admin@europagym.at";
    },

    adminLogin: async () => {
        const email = document.getElementById('admin-user').value;
        const pass = document.getElementById('admin-pass').value;
        try {
            await auth.signInWithEmailAndPassword(email, pass);
            sessionStorage.setItem('adminUser', email);
            document.getElementById('admin-auth-modal').classList.add('hidden');
            location.reload(); 
        } catch (error) { alert("Fehler: " + error.message); }
    },

    adminTab: (tab) => {
        document.querySelectorAll('.admin-view').forEach(v => v.classList.add('hidden'));
        document.getElementById('admin-' + tab).classList.remove('hidden');
        document.querySelectorAll('.admin-tab-btn').forEach(b => { b.classList.remove('bg-white/10', 'text-white'); b.classList.add('text-gray-500'); });
        const btn = document.getElementById('t-' + tab);
        if(btn) { btn.classList.add('bg-white/10', 'text-white'); btn.classList.remove('text-gray-500'); }
        if(tab === 'mod') app.renderModQueue();
        if(tab === 'orders') app.renderOrders();
    },

    submitOrder: async () => {
        const id = 'ORD-' + Math.floor(Math.random() * 90000 + 10000);
        const recipient = document.getElementById('order-recipient').value;
        const grade = document.getElementById('order-grade').value;
        const room = document.getElementById('order-room').value;
        const message = document.getElementById('order-message').value;
        const selectedBtn = document.querySelector('input[name="product"]:checked');
        if (!recipient || !grade || !room || !message) { alert("Bitte ausfüllen."); return; }
        let currentPrice = app.priceList[selectedBtn.value] || 0;
        if (app.isVip && currentPrice > 0) currentPrice *= 0.85;
        const submitBtn = document.querySelector('#order-form button[type="submit"]');
        submitBtn.disabled = true;
        try {
            const newOrder = { recipient, grade, room, product: selectedBtn.value, message, vibe: document.getElementById('order-vibe').value, sender: app.currentUser, status: 'Bestellt', isVip: app.isVip, priceAtOrder: currentPrice, timestamp: Date.now() };
            await db.collection("orders").doc(id).set(newOrder);
            await db.collection("metadata").doc("stats").set({ count: firebase.firestore.FieldValue.increment(1) }, { merge: true });
            document.getElementById('qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${id}&color=7c3aed&bgcolor=ffffff`;
            document.getElementById('qr-order-id').innerText = id;
            document.getElementById('qr-modal').classList.remove('hidden');
            document.getElementById('order-form').reset();
        } catch (err) { alert(err.message); } finally { submitBtn.disabled = false; }
    },

    updateTotal: () => {
        const selected = document.querySelector('input[name="product"]:checked');
        if (!selected) return;
        let price = app.priceList[selected.value] || 0;
        if (app.isVip && price > 0) price = price * 0.85; 
        document.getElementById('order-total').innerText = (app.isVip ? "👑 " : "") + (price === 0 ? "Gratis" : price.toFixed(2).replace('.', ',') + '€');
    },

    setVibe: (vibe) => {
        document.getElementById('order-vibe').value = vibe;
        document.querySelectorAll('.vibe-btn').forEach(btn => {
            if(btn.dataset.vibe === vibe) btn.classList.replace('text-gray-400', 'text-brand-accent');
            else btn.classList.replace('text-brand-accent', 'text-gray-400');
        });
    },

    renderFeed: (filter = 'all') => {
        const container = document.getElementById('feed-container');
        container.innerHTML = '';
        let posts = (app.data.posts || []).filter(p => p.approved);
        if(filter === 'new') posts.sort((a,b) => b.timestamp - a.timestamp);
        else posts.sort((a,b) => b.hearts - a.hearts); 
        posts.forEach(post => {
            container.innerHTML += `
                <div class="glass-card p-6 rounded-2xl mb-4">
                    <p class="text-gray-200 text-sm mb-4">"${post.text}"</p>
                    <div class="flex justify-between items-center pt-3 border-t border-white/5">
                        <span class="text-[9px] font-bold text-gray-500 uppercase">Community</span>
                        <button onclick="app.heartPost('${post.id}')" class="text-gray-500"><i class="fa-solid fa-heart"></i> ${post.hearts}</button>
                    </div>
                </div>`;
        });
    },

    heartPost: (id) => db.collection("posts").doc(id).update({ hearts: firebase.firestore.FieldValue.increment(1) }),
    submitPost: () => {
        const txt = document.getElementById('new-post-content').value;
        if(!txt.trim()) return;
        db.collection("posts").add({ text: txt, hearts: 0, approved: false, timestamp: Date.now(), author: app.currentUser })
        .then(() => { document.getElementById('new-post-content').value = ''; document.getElementById('post-modal').classList.add('hidden'); app.showToast("Wartet auf Freigabe"); });
    },

    filterWall: (type) => {
        document.querySelectorAll('#wall button').forEach(btn => btn.classList.remove('active-filter'));
        document.getElementById('filter-' + type).classList.add('active-filter');
        app.renderFeed(type);
    },

    renderMyOrders: () => {
        const list = document.getElementById('my-orders-list');
        const mine = (app.data.orders || []).filter(o => o.sender === app.currentUser).sort((a,b) => b.timestamp - a.timestamp);
        list.innerHTML = mine.map(o => `
            <div class="glass-card p-6 rounded-[2rem] mb-4">
                <div class="flex justify-between items-start mb-6">
                    <div><div class="text-[10px] text-brand-primary font-mono">${o.id}</div><div class="font-bold text-white">${o.recipient}</div></div>
                    <div class="text-brand-accent text-[10px] uppercase font-bold">${o.status}</div>
                </div>
            </div>`).join('') || '<div class="text-center text-gray-500">Keine Bestellungen.</div>';
    },

    renderOrders: () => {
        const list = document.getElementById('orders-list');
        list.innerHTML = (app.data.orders || []).map(o => `
            <div class="glass-card p-4 rounded-xl text-xs mb-2">
                <div class="flex justify-between font-bold"><span>${o.id}</span><span>${o.status}</span></div>
                <div class="text-white">${o.product} für ${o.recipient}</div>
                <button onclick="app.showOrderDetails('${o.id}')" class="w-full mt-2 py-2 bg-white/5 rounded">Öffnen</button>
            </div>`).join('');
    },

    renderModQueue: () => {
        const q = document.getElementById('mod-queue');
        const pending = (app.data.posts || []).filter(p => !p.approved);
        q.innerHTML = pending.map(p => `
            <div class="glass-card p-4 flex justify-between items-center mb-2">
                <p class="text-xs">"${p.text}"</p>
                <div class="flex gap-2">
                    <button onclick="app.modAction('${p.id}', true)" class="text-green-500">✔</button>
                    <button onclick="app.modAction('${p.id}', false)" class="text-red-500">✘</button>
                </div>
            </div>`).join('');
    },

    modAction: (id, approve) => approve ? db.collection("posts").doc(id).update({ approved: true }) : db.collection("posts").doc(id).delete(),

    startScanner: () => {
        document.getElementById('reader').classList.remove('hidden');
        app.html5QrCode = new Html5Qrcode("reader");
        app.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250, videoConstraints: { facingMode: "environment" } }, (decodedText) => {
            app.html5QrCode.stop().then(() => { document.getElementById('reader').classList.add('hidden'); app.showOrderDetails(decodedText); });
        }).catch(err => alert("Kamera Fehler: " + err));
    },

    showOrderDetails: (id) => {
        const order = app.data.orders.find(o => o.id === id);
        if (!order) return;
        app.activeOrderId = id;
        document.getElementById('det-id').innerText = id;
        document.getElementById('det-recipient').innerText = order.recipient;
        document.getElementById('det-room').innerText = `${order.room} (${order.grade})`;
        document.getElementById('det-product').innerText = order.product;
        document.getElementById('det-message').innerText = order.message;
        document.getElementById('active-order-view').classList.remove('hidden');
    },

    updateStatus: (newStatus) => db.collection("orders").doc(app.activeOrderId).update({ status: newStatus }).then(() => { app.showToast(newStatus); document.getElementById('active-order-view').classList.add('hidden'); }),

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