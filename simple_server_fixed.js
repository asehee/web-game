// Complete WaveWar server with Phaser physics
const express = require("express");
const app = express();
const server = require('http').Server(app);
const io = require("socket.io")(server);

// Phaser.js for server-side physics
const Phaser = require('phaser');

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
var playerList = {};
var planetList = {};
var asteroidList = {};
var bulletNum = 0;
var shipInfoList = {};
let leaderBoard = [];

var playerNum = 0;
var mapWidth = 4000;
var mapHeight = 3000;

// Bullet classes
var baseBullet = new Phaser.Class({
    Extends: Phaser.GameObjects.Image,
    
    initialize: function Bullet(scene) {
        Phaser.GameObjects.Image.call(this, scene, 0, 0, 'baseLaser');
        this.id = null;
        this.playerId = null;
        this.incX = 0;
        this.incY = 0;
        this.lifespan = 0;
        this.speed = Phaser.Math.GetSpeed(800, 1);
    },

    fire: function(playerInfo) {
        this.setActive(true);
        this.setVisible(true);
        this.setPosition(playerInfo.x, playerInfo.y);

        var angle = Phaser.Math.Angle.Between(playerInfo.input.mouseX, playerInfo.input.mouseY, playerInfo.x, playerInfo.y);
        this.setRotation(Math.PI / 2 - angle);
        this.incX = Math.cos(angle);
        this.incY = Math.sin(angle);
    },

    update: function(time, delta) {
        this.lifespan -= delta;
        this.x -= this.incX * (this.speed * delta);
        this.y -= this.incY * (this.speed * delta);

        if (this.lifespan <= 0) {
            io.emit('destroyBullet', this.id);
            this.destroy();
        }
        io.emit('updateBullet', {id: this.id, x: this.x, y: this.y});
    }
});

// Phaser game configuration
var config = {
    type: Phaser.HEADLESS,
    width: mapWidth,
    height: mapHeight,
    autoFocus: false,
    physics: {
        default: 'arcade',
        arcade: {
            debug: false
        }
    },
    fps: {
        target: 60,
        forceSetTimeOut: true
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
}

function preload() {
    this.load.image('baseShip', 'resource/image/ship/spaceShips_0011.png');
    this.load.image('heavyShip', 'resource/image/ship/spaceShips_0012.png');
    this.load.image('sniperShip', 'resource/image/ship/spaceShips_0013.png');
    this.load.image('baseLaser', 'resource/image/laser/laserRed07.png');
    this.load.image('heavyLaser', 'resource/image/laser/laserRed06.png');
    this.load.image('sniperLaser', 'resource/image/laser/laserRed01.png');
    this.load.image('asteroid1', 'resource/image/planet/meteorBrown_big1.png');
    this.load.image('asteroid2', 'resource/image/planet/meteorBrown_big2.png');
    this.load.image('asteroid3', 'resource/image/planet/meteorBrown_big3.png');
    this.load.image('jupiter', 'resource/image/planet/simple_planet_21_h.png');
    this.load.image('earth', 'resource/image/planet/simple_planet_23_h.png');
    this.load.image('moon', 'resource/image/planet/simple_planet_09_h.png');
    this.load.image('venus', 'resource/image/planet/planet6_h.png');
}

function create() {
    console.log("Phaser server scene created successfully");
    // Player group
    this.players = this.physics.add.group();
    // Planet group
    this.planets = this.physics.add.staticGroup();
    addPlanets(this);
    // Asteroid group
    this.asteroids = this.physics.add.group();
    addAsteroid(this);
    // Bullet groups
    this.baseBullets = this.physics.add.group({
        classType: baseBullet,
        runChildUpdate: true
    });

    // Collision setup
    gameCollide(this, this.players, this.asteroids, this.planets, this.baseBullets);
    console.log("Game collision setup complete");

    io.on('connect', (socket) => {
        let self = this;
        socket.emit('worldBounds', {w: mapWidth, h: mapHeight});
        socket.emit('planets', {planetList: planetList, asteroidList: asteroidList});
        socket.emit('currentPlayerList', playerList);
        
        socket.on('selectShip', (inputData) => {
            managePlayerInfo(inputData, socket.id);
            socket.emit('addMine', {
                myPlayerInfo: playerList[socket.id], 
                hp: shipInfoList[socket.id].hp, 
                leaderBoard: leaderBoard, 
                playerList: playerList
            });
            addPlayer(self, playerList[socket.id], shipInfoList[socket.id]);
            socket.broadcast.emit('newPlayer', {
                playerInfo: playerList[socket.id], 
                leaderBoard: leaderBoard
            });
            playerNum++;
            console.log("플레이어 수 : " + playerNum);
        });

        socket.on('disconnect', (reason) => {
            removePlayer(self, socket.id);
            io.emit("outPlayer", {playerId: socket.id, leaderBoard: leaderBoard});
            playerNum--;
            console.log("플레이어 수 : " + playerNum);
        });

        socket.on('moveShip', (inputData) => {
            console.log(`Player ${socket.id} moveShip:`, inputData);
            handlePlayerMove(self, socket.id, inputData);
        });
        
        socket.on('rotateShip', (inputData) => {
            handlePlayerRotation(self, socket.id, inputData);
        });

        socket.on('fireBullet', (inputData) => {
            if(playerList[socket.id]) {
                playerList[socket.id].input.isDown = inputData;
            }
            if(bulletNum > 1000000) {
                bulletNum = 0;
            }
        });
    });
}

function update(time, delta) {
    // Debug: 매 초마다 한 번씩 로그 출력
    if (Math.floor(time / 1000) % 1 === 0 && time % 1000 < 50) {
        console.log(`Update loop running - Players: ${this.players.getChildren().length}`);
    }
    
    this.players.getChildren().forEach((player) => {
        const input = playerList[player.playerId].input;
        const shipInfo = shipInfoList[player.playerId];
        
        // Set rotation based on mouse position
        player.setRotation(Phaser.Math.Angle.Between(input.mouseX, input.mouseY, player.x, player.y) - Math.PI / 2);

        if(input.W) {
            console.log(`Player ${player.playerId} moving - W:${input.W}, Position: ${player.x},${player.y}, Rotation: ${player.rotation}`);
            // Apply physics-based movement
            this.physics.velocityFromRotation(player.rotation - Math.PI/2, shipInfo.moveSpeed, player.body.acceleration);
            console.log(`Applied acceleration - moveSpeed: ${shipInfo.moveSpeed}, acceleration:`, player.body.acceleration);
        } else {
            player.setAcceleration(0);
        }

        // Handle bullet firing
        if (input.isDown && time > shipInfo.lastFiredTime) {
            let bullet = this.baseBullets.get();
            if (bullet) {
                registerBulletInfo(bullet, player, shipInfo);
                bullet.fire(playerList[player.playerId]);
                shipInfo.lastFiredTime = time + shipInfo.attSpeed;
            }
        }

        // Update player position and background scroll
        playerList[player.playerId].x = player.x;
        playerList[player.playerId].y = player.y;
        playerList[player.playerId].rotation = player.rotation;
        playerList[player.playerId].bg.x = player.body.deltaX() * 0.5;
        playerList[player.playerId].bg.y = player.body.deltaY() * 0.5;
    });

    // Send updates to clients
    io.emit('playerUpdates', {playerList: playerList, time: Date.now()});

    // Update asteroids
    this.asteroids.getChildren().forEach((asteroid) => {
        asteroidList[asteroid.id].x = asteroid.x;
        asteroidList[asteroid.id].y = asteroid.y;
    });
    io.emit('asteroidMove', asteroidList);

    // Wrap asteroids around map boundaries
    this.physics.world.wrap(this.asteroids, 5);
}

function managePlayerInfo(inputData, playerId) {
    let x = Phaser.Math.Between(1000, mapWidth - 1000);
    let y = Phaser.Math.Between(1000, mapHeight - 1000);
    let shipSort = inputData.shipSort;
    let shipSortNum = inputData.shipSortNum;

    playerList[playerId] = {
        rotation: 0,
        x: x,
        y: y,
        playerName: inputData.playerName,
        playerId: playerId,
        ship: shipSort,
        bg: { x: 0, y: 0 },
        input: {
            mouseX: x,
            mouseY: y,
            W: false,
            isDown: false
        }
    };

    // Ship stats based on type
    if(shipSortNum === 1) { // baseShip
        shipInfoList[playerId] = {
            sortNum: shipSortNum,
            hp: 3,
            level: 0,
            laser: 'baseLaser',
            attPower: 1,
            lastFiredTime: 0,
            attSpeed: 500,
            moveSpeed: 400,
            lifespan: 800
        };
    } else if(shipSortNum === 2) { // heavyShip
        shipInfoList[playerId] = {
            sortNum: shipSortNum,
            hp: 4,
            level: 0,
            laser: 'heavyLaser',
            attPower: 2,
            lastFiredTime: 0,
            attSpeed: 800,
            moveSpeed: 250,
            lifespan: 600
        };
    } else if(shipSortNum === 3) { // sniperShip
        shipInfoList[playerId] = {
            sortNum: shipSortNum,
            hp: 2,
            level: 0,
            laser: 'sniperLaser',
            attPower: 3,
            lastFiredTime: 0,
            attSpeed: 1000,
            moveSpeed: 450,
            lifespan: 1200
        };
    }

    leaderBoard.push({
        playerId: playerId, 
        level: 0, 
        playerName: inputData.playerName, 
        ship: playerList[playerId].ship
    });
}

function handlePlayerRotation(self, playerId, input) {
    self.players.getChildren().forEach((player) => {
        if (playerId === player.playerId) {
            playerList[player.playerId].input.mouseX = input.mouseX;
            playerList[player.playerId].input.mouseY = input.mouseY;
            return;
        }
    });
}

function handlePlayerMove(self, playerId, input) {
    console.log(`handlePlayerMove - Player ${playerId}, Input:`, input);
    let playerFound = false;
    self.players.getChildren().forEach((player) => {
        if (playerId === player.playerId) {
            playerList[player.playerId].input.W = input.W;
            console.log(`Updated player ${playerId} W input to:`, input.W);
            playerFound = true;
            return;
        }
    });
    if (!playerFound) {
        console.log(`Player ${playerId} not found in players group`);
    }
}

function addPlayer(self, playerInfo, shipInfo) {
    console.log(`Adding player ${playerInfo.playerId} at position ${playerInfo.x}, ${playerInfo.y} with ship ${playerInfo.ship}`);
    const player = self.physics.add.image(playerInfo.x, playerInfo.y, playerInfo.ship).setOrigin(0.5, 0.5);
    self.players.add(player);
    player.setDrag(100);
    player.setMaxVelocity(shipInfo.moveSpeed);
    player.setBounce(0.2, 0.2);
    player.setCollideWorldBounds(true);
    player.playerId = playerInfo.playerId;
    console.log(`Player ${playerInfo.playerId} added successfully. Total players: ${self.players.getChildren().length}`);
}

function removePlayer(self, playerId) {
    self.players.getChildren().forEach((player) => {
        if (playerId === player.playerId) {
            player.destroy();
            return;
        }
    });
    delete playerList[playerId];
    delete shipInfoList[playerId];
    removeLeaderBoard(playerId);
}

function removeLeaderBoard(playerId) {
    leaderBoard = leaderBoard.filter(player => player.playerId !== playerId);
}

function addPlanets(self) {
    planetList = [
        { planet: 'jupiter', x: 1000, y: 500 },
        { planet: 'earth', x: 2200, y: 1000 },
        { planet: 'moon', x: 700, y: 2000 },
        { planet: 'venus', x: 2000, y: 2200 }
    ]; 
     
    self.planets.create(planetList[0].x, planetList[0].y, 'jupiter').setCircle(258);
    self.planets.create(planetList[1].x, planetList[1].y, 'earth').setCircle(258);
    self.planets.create(planetList[2].x, planetList[2].y, 'moon').setCircle(285, -2, 20);
    self.planets.create(planetList[3].x, planetList[3].y, 'venus').setCircle(138, 2, 2);
}

function addAsteroid(self) {
    var ranNum = 15; // Fixed number for consistency
    console.log('소행성 개수 : ' + ranNum);
    
    for(var i = 0; i < ranNum; i++) {
        var x = Math.floor(Math.random() * (mapWidth - 200)) + 100;
        var y = Math.floor(Math.random() * (mapHeight - 200)) + 100;
        var xVel = Phaser.Math.Between(-100, 100);
        var yVel = Phaser.Math.Between(-100, 100);
        var asteroidType = `asteroid${(i % 3) + 1}`;
        
        var asteroid = self.asteroids.create(x, y, asteroidType)
            .setCircle(43)
            .setBounce(1, 1)
            .setVelocity(xVel, yVel);
        asteroid.id = i;
        
        asteroidList[i] = {
            id: i,
            asteroid: asteroidType,
            x: x,
            y: y,
            rotation: 0
        };
    }
}

function registerBulletInfo(bullet, player, shipInfo) {
    bullet.id = bulletNum;
    bullet.playerId = player.playerId;
    bullet.lifespan = shipInfo.lifespan;
    
    var bulletInfo = {
        id: bulletNum++,
        playerId: player.playerId,
        sortNum: shipInfo.sortNum,
        bullet: shipInfo.laser,
        x: player.x,
        y: player.y,
        rotation: player.rotation
    };

    io.emit('addBullet', bulletInfo);
}

function gameCollide(self, players, asteroids, planets, baseBullets) {
    self.physics.add.collider(players);
    self.physics.add.collider(asteroids);
    self.physics.add.collider(players, planets);
    self.physics.add.collider(players, asteroids);
    self.physics.add.collider(asteroids, planets);
    self.physics.add.collider(baseBullets, planets, hitElement);
    self.physics.add.overlap(baseBullets, asteroids, hitElement);
}

function hitElement(bulletHit, elementHit) {
    if (bulletHit.active === true && elementHit.active === true) {
        io.emit('hitBullet', bulletHit.id);
        bulletHit.destroy();
    }
}

// Start Phaser game
console.log("Starting Phaser game server...");
const game = new Phaser.Game(config);

game.events.once('ready', () => {
    console.log("Phaser game server ready!");
});

const PORT = process.env.PORT || 9999;
server.listen(PORT, () => {
    console.log(`WaveWar server running on port ${PORT}`);
    console.log(`Game available at: http://localhost:${PORT}/wavewar`);
    console.log("Phaser physics server initialized");
});