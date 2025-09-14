// Simple express server without canvas dependency
const express = require("express");
const app = express();
const server = require('http').Server(app);
const io = require("socket.io")(server);

// Serve wavewar game
app.get("/wavewar", function(req, res) {
    res.sendFile(__dirname + "/wavewar_client.html");
});

// Static files
app.use('/static', express.static(__dirname + '/resource'));

// CORS for external access
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Game state
const players = {};
const bullets = {};
let bulletId = 0;
const worldSize = { w: 4000, h: 3000 };
const planetList = [
    { planet: 'jupiter', x: 1000, y: 500 },
    { planet: 'earth', x: 2200, y: 1000 },
    { planet: 'moon', x: 700, y: 2000 },
    { planet: 'venus', x: 2000, y: 2200 }
];
const asteroidList = {};

// Initialize asteroids
for (let i = 0; i < 15; i++) {
    asteroidList[i] = {
        id: i,
        asteroid: `asteroid${(i % 3) + 1}`,
        x: Math.random() * 3800 + 100,
        y: Math.random() * 2800 + 100,
        rotation: Math.random() * Math.PI * 2
    };
}

// Socket.io multiplayer with complete game logic
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Send world bounds to client (must match original)
    socket.emit('worldBounds', worldSize);
    
    // Send planets and asteroids
    socket.emit('planets', {
        planetList: planetList,
        asteroidList: asteroidList
    });
    
    // Send current players to new player
    socket.emit('currentPlayerList', players);
    
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('outPlayer', { 
                playerId: socket.id, 
                leaderBoard: Object.values(players).map(p => ({playerName: p.playerName, level: 0, ship: p.ship}))
            });
        }
    });
    
    // Handle ship selection - CRITICAL: Match original data structure
    socket.on('selectShip', (data) => {
        console.log('Ship selected:', data);
        const startX = Math.random() * 2000 + 1000;
        const startY = Math.random() * 1000 + 1000;
        
        const playerInfo = {
            playerId: socket.id,
            playerName: data.playerName,
            ship: data.shipSort,
            x: startX,
            y: startY,
            rotation: 0,
            bg: {              // CRITICAL: Missing bg object added
                x: 0,
                y: 0
            },
            input: {           // CRITICAL: Input state tracking
                mouseX: startX,
                mouseY: startY,
                W: false,
                isDown: false
            },
            deltaX: 0,         // For physics calculations
            deltaY: 0,
            lastShotTime: 0    // For bullet rate limiting
        };
        
        players[socket.id] = playerInfo;
        
        // Send complete player initialization (match original addMine structure)
        socket.emit('addMine', {
            myPlayerInfo: playerInfo,
            hp: 100,
            leaderBoard: Object.values(players).map(p => ({playerName: p.playerName, level: 0, ship: p.ship})),
            playerList: players
        });
        
        // Notify other players about new player
        socket.broadcast.emit('newPlayer', {
            playerInfo: playerInfo,
            leaderBoard: Object.values(players).map(p => ({playerName: p.playerName, level: 0, ship: p.ship}))
        });
    });
    
    // Handle ship movement - Just store input state
    socket.on('moveShip', (data) => {
        console.log(`Player ${socket.id} moveShip:`, data);
        if (players[socket.id]) {
            players[socket.id].input.W = data.W;
            console.log(`Updated player ${socket.id} W input to:`, data.W);
        }
    });
    
    // Handle ship rotation - Store mouse position
    socket.on('rotateShip', (data) => {
        if (players[socket.id]) {
            const player = players[socket.id];
            player.input.mouseX = data.mouseX;
            player.input.mouseY = data.mouseY;
            const angle = Math.atan2(data.mouseY - player.y, data.mouseX - player.x);
            player.rotation = angle;
        }
    });
    
    // Handle bullets - Store firing state and create bullets
    socket.on('fireBullet', (data) => {
        console.log(`Player ${socket.id} fireBullet:`, data);
        if (players[socket.id]) {
            players[socket.id].input.isDown = data;
            
            // Create bullet when firing starts
            if (data === true) {
                const player = players[socket.id];
                const currentTime = Date.now();
                
                // Check if enough time has passed since last shot (rate limiting)
                if (!player.lastShotTime || currentTime - player.lastShotTime > 300) {
                    console.log(`Creating bullet for player ${player.playerId} at position ${player.x}, ${player.y}`);
                    createBullet(player);
                    player.lastShotTime = currentTime;
                } else {
                    console.log(`Shot too soon - last shot was ${currentTime - player.lastShotTime}ms ago`);
                }
            }
        }
    });
});

// Game loop - Physics and movement calculation
setInterval(() => {
    if (Object.keys(players).length > 0) {
        // Process movement for each player
        Object.keys(players).forEach(id => {
            const player = players[id];
            
            if (player.input.W) {
                // Store previous position for delta calculation
                const prevX = player.x;
                const prevY = player.y;
                
                // 단순한 움직임 - 마우스 방향으로 직진
                const speed = 2;
                player.x += Math.cos(player.rotation) * speed;
                player.y += Math.sin(player.rotation) * speed;
                
                // Keep within world bounds
                player.x = Math.max(50, Math.min(worldSize.w - 50, player.x));
                player.y = Math.max(50, Math.min(worldSize.h - 50, player.y));
                
                // Calculate delta for background scrolling
                player.deltaX = player.x - prevX;
                player.deltaY = player.y - prevY;
                
                // Background scroll calculation
                player.bg.x = player.deltaX * 0.5;
                player.bg.y = player.deltaY * 0.5;
                
                console.log(`Player ${id} moving to: ${player.x}, ${player.y}`);
            } else {
                // No movement, no background scroll
                player.bg.x = 0;
                player.bg.y = 0;
                player.deltaX = 0;
                player.deltaY = 0;
            }
        });
        
        // Create update packet with proper structure
        const updateData = {
            playerList: {}
        };
        
        Object.keys(players).forEach(id => {
            const player = players[id];
            updateData.playerList[id] = {
                playerId: player.playerId,
                x: player.x,
                y: player.y,
                rotation: player.rotation,
                bg: {                    
                    x: player.bg.x,
                    y: player.bg.y
                }
            };
        });
        
        io.emit('playerUpdates', updateData);
        
        // Update bullets
        updateBullets();
    }
}, 16); // ~60 FPS update rate for smoother movement

// Bullet creation function - Simple approach
function createBullet(player) {
    // 단순하게: 마우스 방향으로 총알 발사
    const mouseX = player.input.mouseX;
    const mouseY = player.input.mouseY;
    
    const angle = Math.atan2(mouseY - player.y, mouseX - player.x);
    
    const bullet = {
        id: bulletId++,
        playerId: player.playerId,
        x: player.x,
        y: player.y,
        rotation: angle, // 마우스 방향으로 회전
        velocityX: Math.cos(angle) * 6, // 마우스 방향으로 이동
        velocityY: Math.sin(angle) * 6,
        lifeTime: 3000,
        createdAt: Date.now(),
        bullet: getBulletType(player.ship)
    };
    
    bullets[bullet.id] = bullet;
    
    // Send to clients
    io.emit('addBullet', bullet);
    console.log(`Simple bullet ${bullet.id} - angle: ${angle.toFixed(2)}, velocity: ${bullet.velocityX.toFixed(2)}, ${bullet.velocityY.toFixed(2)}`);
}

// Get bullet type based on ship
function getBulletType(ship) {
    switch(ship) {
        case 'baseShip': return 'baseLaser';
        case 'heavyShip': return 'heavyLaser'; 
        case 'sniperShip': return 'sniperLaser';
        default: return 'baseLaser';
    }
}

// Update all bullets
function updateBullets() {
    const currentTime = Date.now();
    const bulletsToRemove = [];
    
    Object.keys(bullets).forEach(id => {
        const bullet = bullets[id];
        
        // Check if bullet has expired
        if (currentTime - bullet.createdAt > bullet.lifeTime) {
            bulletsToRemove.push(id);
            return;
        }
        
        // Update bullet position
        bullet.x += bullet.velocityX;
        bullet.y += bullet.velocityY;
        
        // Check if bullet is out of world bounds
        if (bullet.x < 0 || bullet.x > worldSize.w || bullet.y < 0 || bullet.y > worldSize.h) {
            bulletsToRemove.push(id);
            return;
        }
        
        // Send position update to clients
        io.emit('updateBullet', {id: bullet.id, x: bullet.x, y: bullet.y});
    });
    
    // Remove expired bullets
    bulletsToRemove.forEach(id => {
        delete bullets[id];
        io.emit('destroyBullet', id);
        console.log(`Removed bullet ${id}`);
    });
}

const PORT = process.env.PORT || 9999;
server.listen(PORT, () => {
    console.log(`WaveWar server running on port ${PORT}`);
    console.log(`Game available at: http://localhost:${PORT}/wavewar`);
});