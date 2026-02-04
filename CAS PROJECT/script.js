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
    data: { posts: [], orders: [] },
    currentUser: null,
    html5QrCode: null,
    activeOrderId: null,
    isVip: false,
    listenersStarted: false,

    // --- NEU: FIXE PREISLISTE ---
    // Stelle sicher, dass die value="" Attribute in deiner HTML genau diesen Namen entsprechen!
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
        auth.onAuthStateChanged((user) => {
            if (user) {
                app.handleLoginSuccess(user);
                app.startDatabaseListeners();
            } else {
                document.getElementById('auth-overlay').classList.remove('hidden');
            }
        });

        const adminUser = sessionStorage.getItem('adminUser');
        if(adminUser) console.log("Admin Session aktiv");

        app.updateCountdown();
        setInterval(app.updateCountdown, 1000);
        app.setVibe('classic');
    },

    startDatabaseListeners: () => {
        if (app.listenersStarted) return;
        app.listenersStarted = true;

        console.log("Starte Datenbank-Verbindungen...");

        db.collection("posts").orderBy("timestamp", "desc").onSnapshot(snapshot => {
            app.data.posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            app.renderFeed();
            app.renderModQueue(); 
        }, err => console.log("Post-Fehler:", err));

        db.collection("orders").onSnapshot(snapshot => {
            app.data.orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            app.updateStats(); 
            app.renderMyOrders();
            app.renderOrders(); 
        }, err => console.log("Order-Fehler:", err));
        
        app.initPresence();
    },

    initPresence: () => {
        const onlineRef = rtdb.ref('.info/connected');
        onlineRef.on('value', (snapshot) => {
            if (snapshot.val() === true && app.currentUser) {
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

    getVipList: () => {
        const paidOrders = (app.data.orders || []).filter(o => {
            // Logik: Wer Geld ausgegeben hat (Preis > 0), zählt als potenzieller VIP
            return (o.priceAtOrder > 0);
        });

        const sorted = paidOrders.sort((a, b) => a.timestamp - b.timestamp);
        return new Set(sorted.slice(0, 100).map(o => o.sender));
    },

    loginWithMicrosoft: async () => {
        const provider = new firebase.auth.OAuthProvider('microsoft.com');
        provider.setCustomParameters({
            prompt: 'select_account',
            tenant: 'f7bb63a9-5ed7-4a21-b43a-3f684ec4938b' 
        });

        try {
            document.getElementById('login-container').classList.add('hidden');
            document.getElementById('auth-loading').classList.remove('hidden');

            const result = await auth.signInWithPopup(provider);
            const user = result.user;
            
            if (user.email && user.email.toLowerCase().endsWith('@europagym.at')) {
                // Login OK
            } else {
                await auth.signOut();
                alert("Zugriff verweigert: Nur @europagym.at Adressen erlaubt.");
                location.reload();
            }

        } catch (error) {
            console.error("Login Fehler:", error);
            alert("Login fehlgeschlagen: " + error.message);
            location.reload();
        }
    },

    handleLoginSuccess: (user) => {
        if (!user.email.toLowerCase().endsWith('@europagym.at')) {
            auth.signOut();
            return;
        }

        app.currentUser = user.email.toLowerCase();
        sessionStorage.setItem('userEmail', app.currentUser);

        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('safety-banner').classList.remove('hidden');
        
        let displayName = user.displayName || app.currentUser.split('@')[0];
        document.getElementById('current-user').innerText = displayName;
        document.getElementById('user-initials').innerText = app.currentUser.charAt(0).toUpperCase();
        document.getElementById('profile-email').innerText = app.currentUser;
        
        if(app.data.orders.length > 0) app.checkVipStatus();
        app.showToast("Erfolgreich eingeloggt 🚀");
    },

    logout: () => {
        sessionStorage.removeItem('userEmail');
        auth.signOut().then(() => {
            location.reload();
        });
    },

    nav: (id) => {
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        document.querySelectorAll('nav button').forEach(b => {
            b.classList.remove('active-nav', 'text-white');
            b.classList.add('text-gray-500');
        });
        const btn = document.getElementById('nav-' + id);
        if(btn) { btn.classList.remove('text-gray-500'); btn.classList.add('active-nav', 'text-white'); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // --- ÄNDERUNG 1: VIP STATUS AUCH IM HEADER ANZEIGEN ---
    checkVipStatus: () => {
        const vipUsers = app.getVipList();
        app.isVip = vipUsers.has(app.currentUser);

        // Elemente holen
        const indicator = document.getElementById('vip-indicator'); // Falls du das irgendwo anders hast
        const headerBadge = document.getElementById('header-vip-badge'); // Das neue im Header

        if (app.isVip) {
            if(indicator) indicator.classList.remove('hidden');
            if(headerBadge) headerBadge.classList.remove('hidden');
        } else {
            if(indicator) indicator.classList.add('hidden');
            if(headerBadge) headerBadge.classList.add('hidden');
        }
    },

    // --- ÄNDERUNG 2: ADMIN ZUGANG IMMER ABFRAGEN ---
    checkAdminAccess: () => {
        // Wir prüfen NICHT mehr sessionStorage.getItem('adminUser'),
        // sondern zwingen den User immer zur Eingabe.
        
        // Modal öffnen
        document.getElementById('admin-auth-modal').classList.remove('hidden');
        
        // Optional: Admin-Formular zurücksetzen, damit Felder leer sind
        document.getElementById('admin-user').value = "";
        document.getElementById('admin-pass').value = "";
    },
    
    // (Optional) Update auch diese Funktion, damit das VIP Badge beim Laden der Stats aktualisiert wird
    updateStats: () => {
        const total = (app.data.orders || []).length;
        const bigCount = document.getElementById('total-count-big');
        if(bigCount) bigCount.innerText = total;

        const maxGoal = 500; 
        let percentage = (total / maxGoal) * 100;
        if(percentage > 100) percentage = 100;

        const bar = document.getElementById('progress-bar');
        
        if (total < 100) {
            bar.classList.add('is-gold'); 
            if(bigCount) {
                bigCount.classList.add('gold-text-effect');
                bigCount.classList.remove('text-brand-accent');
            }
        } else {
            bar.classList.remove('is-gold');
            if(bigCount) {
                bigCount.classList.remove('gold-text-effect');
                bigCount.classList.add('text-brand-accent');
            }
        }

        bar.style.width = percentage + '%';
        
        // WICHTIG: Hier prüfen wir jedes Mal den VIP Status neu, wenn Daten reinkommen
        app.checkVipStatus(); 
        app.updateTotal(); 
    },

    renderFeed: (filter = 'all') => {
        const container = document.getElementById('feed-container');
        container.innerHTML = '';
        const liked = JSON.parse(localStorage.getItem('cupid_likes')) || [];
        const vipUsers = app.getVipList();

        let posts = (app.data.posts || []).filter(p => p.approved);
        
        if(filter === 'new') posts.sort((a,b) => b.timestamp - a.timestamp);
        else posts.sort((a,b) => b.hearts - a.hearts); 

        if (posts.length === 0) {
            container.innerHTML = '<p class="text-gray-500 col-span-full text-center py-10">Keine Posts.</p>';
            return;
        }

        posts.forEach(post => {
            const isLiked = liked.includes(post.id);
            const isVipPost = vipUsers.has(post.author);
            const vipClasses = isVipPost ? 'border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.15)] bg-yellow-500/5' : '';
            const vipBadge = isVipPost ? '<div class="text-[8px] font-black text-yellow-500 mb-2 flex items-center gap-1"><i class="fa-solid fa-crown"></i> VIP STATUS</div>' : '';
            const verifyLabel = isVipPost ? '<span class="text-[9px] font-bold text-yellow-500 uppercase">Verifiziert</span>' : '<span class="text-[9px] font-bold text-gray-500 uppercase">Community</span>';

            container.innerHTML += `
                <div class="masonry-item glass-card p-6 rounded-2xl break-inside-avoid mb-4 ${vipClasses}">
                    ${vipBadge}
                    <p class="text-gray-200 text-sm leading-relaxed mb-4">"${post.text}"</p>
                    <div class="flex justify-between items-center pt-3 border-t border-white/5">
                        ${verifyLabel}
                        <button onclick="app.heartPost('${post.id}')" class="flex items-center gap-2 ${isLiked ? 'heart-liked' : 'text-gray-500'} transition">
                            <i class="fa-solid fa-heart"></i> <span class="text-xs font-bold">${post.hearts}</span>
                        </button>
                    </div>
                </div>`;
        });
    },

    heartPost: (id) => {
        let liked = JSON.parse(localStorage.getItem('cupid_likes')) || [];
        if(liked.includes(id)) return; 
        liked.push(id);
        localStorage.setItem('cupid_likes', JSON.stringify(liked));
        db.collection("posts").doc(id).update({ hearts: firebase.firestore.FieldValue.increment(1) }).catch(console.error);
    },

    submitPost: () => {
        const txt = document.getElementById('new-post-content').value;
        if(!txt.trim()) return;
        db.collection("posts").add({
            text: txt,
            hearts: 0,
            approved: false,
            timestamp: Date.now(),
            author: app.currentUser 
        }).then(() => {
            document.getElementById('new-post-content').value = '';
            document.getElementById('post-modal').classList.add('hidden');
            app.showToast("Post gesendet (Wartet auf Freigabe)");
        }).catch(err => alert("Fehler: " + err));
    },

    filterWall: (type) => {
        document.querySelectorAll('#wall button').forEach(btn => btn.classList.remove('active-filter'));
        document.getElementById('filter-' + type).classList.add('active-filter');
        app.renderFeed(type);
    },

    // --- NEUE LOGIK: PROZENTUALE PHASEN ---
    getPhaseName: () => {
        const count = (app.data.orders || []).length;
        if (count < 100) return "Start: 0% Rabatt";
        if (count < 200) return "Phase 1: -5% Rabatt 📉";
        if (count < 300) return "Phase 2: -10% Rabatt 📉";
        if (count < 400) return "Phase 3: -15% Rabatt 📉";
        return "ZIEL: 20% RABATT 🔥";
    },

    // --- NEUE LOGIK: FIXE PREISBERECHNUNG ---
    updateTotal: () => {
        const selected = document.querySelector('input[name="product"]:checked');
        if (!selected) return;

        // Preis aus der fixen Liste holen basierend auf dem value des Radio Buttons
        let price = app.priceList[selected.value];
        
        // Fallback, falls value nicht in Liste ist
        if (price === undefined) {
             // Versuche data-price Attribut wenn vorhanden, sonst 0
             price = parseFloat(selected.dataset.price) || 0;
        }

        // VIP Rabatt (bleibt bestehen für normale User-Incentivierung)
        if (app.isVip && price > 0) price = price * 0.85; 

        const displayPrice = price === 0 ? "Gratis" : price.toFixed(2).replace('.', ',') + '€';
        document.getElementById('order-total').innerText = (app.isVip ? "👑 " : "") + displayPrice;
        
        // Anzeige der Phase aktualisieren
        document.getElementById('price-phase-badge').innerText = app.getPhaseName();
        
        // VIP BUNDLE ANZEIGE ENTFERNT wie gewünscht
    },

    setVibe: (vibe) => {
        document.getElementById('order-vibe').value = vibe;
        document.querySelectorAll('.vibe-btn').forEach(btn => {
            if(btn.dataset.vibe === vibe) btn.classList.replace('text-gray-400', 'text-brand-accent');
            else btn.classList.replace('text-brand-accent', 'text-gray-400');
        });
    },

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

        // Preisermittlung für die Datenbank
        let currentPrice = app.priceList[selectedBtn.value];
        if (currentPrice === undefined) currentPrice = 0; // Fallback
        
        const basePrice = currentPrice;
        
        // VIP Rabatt anwenden
        if (app.isVip && currentPrice > 0) currentPrice *= 0.85;

        const submitBtn = document.querySelector('#order-form button[type="submit"]');
        const originalText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.innerText = "Sende Daten...";

        try {
            let imageUrl = null;
            if (app.isVip && fileInput && fileInput.files.length > 0) {
                submitBtn.innerText = "Lade Bild hoch...";
                const file = fileInput.files[0];
                const storageRef = storage.ref(`vip_uploads/${id}_${file.name}`);
                await storageRef.put(file);
                imageUrl = await storageRef.getDownloadURL();
            }

            const newOrder = {
                recipient: recipient,
                grade: grade,
                room: room,
                product: selectedBtn.value,
                message: message,
                vibe: document.getElementById('order-vibe').value,
                sender: app.currentUser,
                status: 'Bestellt', 
                isVip: app.isVip, 
                priceAtOrder: basePrice, 
                timestamp: Date.now(),
                vipImage: imageUrl
            };

            await db.collection("orders").doc(id).set(newOrder);

            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${id}&color=7c3aed&bgcolor=ffffff`;
            document.getElementById('qr-image').src = qrUrl;
            document.getElementById('qr-order-id').innerText = id;
            
            const vipBadge = app.isVip ? '<span class="ml-2 bg-[#fbbf24] text-black text-[9px] px-1 rounded font-bold">VIP</span>' : '';
            const priceText = currentPrice === 0 ? "Kostenlos" : currentPrice.toFixed(2).replace('.', ',') + "€";

            document.getElementById('qr-summary').innerHTML = `
                <div class="flex justify-between"><span>Produkt:</span> <span class="text-white font-bold">${newOrder.product}</span></div>
                <div class="flex justify-between"><span>An:</span> <span class="text-white">${newOrder.recipient}</span></div>
                ${imageUrl ? '<div class="flex justify-between text-yellow-500 text-[10px]"><span>+ Bild Upload</span> <i class="fa-solid fa-check"></i></div>' : ''}
                <div class="flex justify-between mt-2 pt-2 border-t border-white/10 font-bold"><span>Zu zahlen:</span> <span class="text-brand-accent text-lg">${priceText} ${vipBadge}</span></div>
            `;

            document.getElementById('qr-modal').classList.remove('hidden');
            document.getElementById('order-form').reset();
            app.updateTotal(); 

        } catch (err) {
            console.error(err);
            alert("Fehler beim Bestellen: " + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
        }
    },

    renderMyOrders: () => {
        const list = document.getElementById('my-orders-list');
        const mine = (app.data.orders || []).filter(o => o.sender === app.currentUser).sort((a,b) => b.timestamp - a.timestamp);
        const steps = ['Bestellt', 'Bezahlt', 'In Zubereitung', 'In Zustellung', 'Geliefert'];

        list.innerHTML = mine.length ? mine.map(o => {
            let currentIdx = steps.indexOf(o.status);
            if(currentIdx === -1) currentIdx = 0;
            const progress = (currentIdx / (steps.length - 1)) * 100;
            const vipTag = o.isVip ? '<span class="text-[9px] bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 px-1 rounded ml-2">VIP</span>' : '';

            return `
                <div class="glass-card p-6 rounded-[2rem] mb-4 relative overflow-hidden ${o.isVip ? 'border border-yellow-500/20' : ''}">
                    <div class="flex justify-between items-start mb-6">
                        <div>
                            <div class="text-[10px] text-brand-primary font-mono font-bold flex items-center">${o.id} ${vipTag}</div>
                            <div class="font-bold text-white text-lg">${o.recipient}</div>
                            <div class="text-xs text-gray-400">${o.product}</div>
                        </div>
                        <div class="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-brand-accent">
                            ${o.status}
                        </div>
                    </div>
                    <div class="relative w-full h-2 bg-white/10 rounded-full mb-8 mt-2">
                        <div class="tracking-line-fill absolute top-0 left-0 h-full bg-gradient-to-r from-brand-primary to-brand-accent rounded-full shadow-[0_0_10px_#2dd4bf]" style="width: ${progress}%"></div>
                    </div>
                </div>
            `;
        }).join('') : '<div class="text-center text-gray-500 py-10">Keine Bestellungen.</div>';
    },

    checkAdminAccess: () => {
        if (sessionStorage.getItem('adminUser') || auth.currentUser?.email) {
            app.nav('admin');
        } else {
            document.getElementById('admin-auth-modal').classList.remove('hidden');
        }
    },

    adminLogin: async () => {
        const email = document.getElementById('admin-user').value;
        const pass = document.getElementById('admin-pass').value;
        try {
            const userCredential = await auth.signInWithEmailAndPassword(email, pass);
            sessionStorage.setItem('adminUser', userCredential.user.email);
            document.getElementById('admin-auth-modal').classList.add('hidden');
            app.nav('admin');
            app.showToast("Willkommen Admin");
        } catch (error) {
            console.error("Login Error:", error);
            alert("Login fehlgeschlagen.");
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
        if(btn) { btn.classList.add('bg-white/10', 'text-white'); btn.classList.remove('text-gray-500'); }
        if(tab === 'mod') app.renderModQueue();
        if(tab === 'orders') app.renderOrders();
    },

    startScanner: () => {
        document.getElementById('reader').classList.remove('hidden');
        app.html5QrCode = new Html5Qrcode("reader");
        app.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, (decodedText) => {
            app.html5QrCode.stop().then(() => {
                document.getElementById('reader').classList.add('hidden');
                document.getElementById('reader').innerHTML = ""; 
            });
            app.showOrderDetails(decodedText);
            app.showToast("Code erkannt!");
        }).catch(err => alert("Kamera-Fehler: " + err));
    },

    showOrderDetails: (id) => {
        const order = app.data.orders.find(o => o.id === id);
        if (!order) return alert("Bestellung nicht gefunden!");
        app.activeOrderId = id;
        const modal = document.querySelector('#active-order-view .glass-card');
        
        if (order.isVip) {
            modal.classList.add('vip-frame'); 
            document.getElementById('det-id').innerHTML = `${order.id} <span class="ml-2 text-yellow-500 text-xs border border-yellow-500 px-1 rounded bg-yellow-500/10">VIP</span>`;
        } else {
            modal.classList.remove('vip-frame');
            document.getElementById('det-id').innerText = order.id;
        }

        document.getElementById('det-recipient').innerText = order.recipient;
        document.getElementById('det-room').innerText = `${order.room} (${order.grade})`;
        const priceDisplay = order.priceAtOrder !== undefined ? ` (${order.priceAtOrder.toFixed(2)}€)` : '';
        document.getElementById('det-product').innerText = order.product + priceDisplay;
        
        let msgHtml = `"${order.message}"`;
        if (order.vipImage) msgHtml += `<div class="mt-3"><img src="${order.vipImage}" class="rounded-xl w-full max-h-40 object-cover border border-yellow-500/50"></div>`;
        document.getElementById('det-message').innerHTML = msgHtml;
        document.getElementById('active-order-view').classList.remove('hidden');
    },

    updateStatus: (newStatus) => {
        if (!app.activeOrderId) return;
        db.collection("orders").doc(app.activeOrderId).update({ status: newStatus })
        .then(() => {
            app.showToast("Status: " + newStatus);
            document.getElementById('active-order-view').classList.add('hidden');
        }).catch(err => alert("Fehler: " + err));
    },

    renderOrders: () => {
        const list = document.getElementById('orders-list');
        const sortedOrders = (app.data.orders || []).slice().sort((a,b) => {
            if(a.isVip && !b.isVip) return 1; 
            if(!a.isVip && b.isVip) return -1;
            return a.timestamp - b.timestamp;
        });

        list.innerHTML = sortedOrders.reverse().map(o => `
            <div class="glass-card p-4 rounded-xl text-xs space-y-2 ${o.status === 'Geliefert' ? 'opacity-50' : 'bg-black/40'} ${o.isVip ? 'vip-order-highlight' : ''}">
                <div class="flex justify-between font-bold">
                    <span class="${o.isVip ? 'text-yellow-500' : 'text-brand-accent'} font-mono">
                        ${o.id} ${o.isVip ? '👑' : ''}
                    </span>
                    <span class="${o.status === 'Bezahlt' ? 'text-green-400' : 'text-yellow-500'} uppercase">${o.status}</span>
                </div>
                <div class="text-white font-bold">${o.product} für ${o.recipient}</div>
                ${o.vipImage ? '<div class="text-[9px] text-yellow-500"><i class="fa-solid fa-image"></i> Bild liegt bei</div>' : ''}
                <button onclick="app.showOrderDetails('${o.id}')" class="w-full mt-2 py-2 bg-white/5 hover:bg-white/10 rounded font-bold">Öffnen</button>
            </div>
        `).join('') || '<p class="text-center text-gray-500">Keine Daten.</p>';
    },

    renderModQueue: () => {
        const q = document.getElementById('mod-queue');
        const pending = (app.data.posts || []).filter(p => !p.approved);
        q.innerHTML = pending.length ? pending.map(p => `
            <div class="glass-card p-4 rounded-2xl flex justify-between items-center bg-black/40">
                <div class="w-2/3">
                    <div class="text-[10px] text-gray-500 uppercase font-bold mb-1">${p.author}</div>
                    <p class="text-xs text-gray-300">"${p.text}"</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="app.modAction('${p.id}', true)" class="w-10 h-10 rounded-xl bg-green-500/20 text-green-500"><i class="fa-solid fa-check"></i></button>
                    <button onclick="app.modAction('${p.id}', false)" class="w-10 h-10 rounded-xl bg-red-500/20 text-red-500"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `).join('') : '<p class="text-center text-gray-500 italic">Queue leer.</p>';
    },

    modAction: (id, approve) => {
        const docRef = db.collection("posts").doc(id);
        if(approve) docRef.update({ approved: true }).catch(err => alert(err));
        else docRef.delete().catch(err => alert(err));
    },

    updateStats: () => {
        const total = (app.data.orders || []).length;
        document.getElementById('total-count-big').innerText = total;

        const maxGoal = 500; 
        let percentage = (total / maxGoal) * 100;
        if(percentage > 100) percentage = 100;

        const bar = document.getElementById('progress-bar');
        
        // Logik: Gold (VIP) wenn < 100
        if (total < 100) {
            bar.classList.add('is-gold'); // GOLD MODUS AN
            document.getElementById('total-count-big').classList.add('gold-text-effect');
            document.getElementById('total-count-big').classList.remove('text-brand-accent');
        } else {
            bar.classList.remove('is-gold'); // ZURÜCK ZU NORMAL
            document.getElementById('total-count-big').classList.remove('gold-text-effect');
            document.getElementById('total-count-big').classList.add('text-brand-accent');
        }

        bar.style.width = percentage + '%';
        
        app.checkVipStatus(); 
        app.updateTotal(); 
    },

    updateCountdown: () => {
        const diff = new Date('February 14, 2026 00:00:00').getTime() - new Date().getTime();
        if(diff > 0) {
            document.getElementById('days').innerText = String(Math.floor(diff / (1000 * 60 * 60 * 24))).padStart(2, '0');
            document.getElementById('hours').innerText = String(Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
            document.getElementById('minutes').innerText = String(Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
            document.getElementById('seconds').innerText = String(Math.floor((diff % (1000 * 60)) / 1000)).padStart(2, '0');
        }
    },

    showToast: (msg) => {
        const t = document.getElementById('toast');
        if(!t) return;
        document.getElementById('toast-msg').innerText = msg;
        t.classList.remove('translate-x-[150%]');
        setTimeout(() => t.classList.add('translate-x-[150%]'), 3000);
    }
};

document.addEventListener('DOMContentLoaded', app.init);