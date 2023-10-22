const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        methods: ["GET", "POST"],
        credentials: true,
        origin: "http://localhost:5173"
    },
    allowEIO3: true,
    path: "/live"
});
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 3000;

mongoose.connect('mongodb+srv://jelly:board@jellybaord.viv4kml.mongodb.net/?retryWrites=true&w=majority', { useNewUrlParser: true, useUnifiedTopology: true });
const userSchema = new mongoose.Schema({
    username: String,
    email: String,
    pwHash: String,
    pwSalt: String,
    type: String // creator, player
});
const User = mongoose.model('User', userSchema);

const boardSchema = new mongoose.Schema({
    title: String,
    description: String,
    creator: String, // user id
    createdAt: Date,
    slides: [{
        title: String,
        id: String,
        type: String,     
        data: Object,
        usageHistory: Object
    }],
    public: Boolean
})
const Board = mongoose.model('Board', boardSchema);


app.use(bodyParser.json());
app.use(cookieParser());



function generateCode(){
    // gen 5 letter code
    var code = "";
    while(activeSessions.filter(session => session.code == code).length == 0 && code == ""){
        code = "";
        for(var i = 0; i < 5; i++){
            code += String.fromCharCode(65 + Math.floor(Math.random() * 26));
        }
        code = code.toUpperCase();
    }
    return code;
}

function generateUniqId(){
    // random 8 char id
    var id = "";
    while(id == ""){
        id = "";
        for(var i = 0; i < 8; i++){
            id += String.fromCharCode(65 + Math.floor(Math.random() * 26));
        }
        id = id.toUpperCase();
    }
    return id;
}


io.on('connection', (socket) => {
    socket.on('ping', (data) => {
        socket.emit('home_active_sessions', activeSessions.length);
    });

    socket.on("host_create_session", (data) => {
        
        
        const code = generateCode();
        activeSessions.push({
            code: code,
            aliveUntil: new Date(),
            players: [],
            stateData: {
                started: false,
                interaction: {
                    canRespond: true,
                    type: "submission"
                },
                answers: {},
                currentSlide: {}
            },
            hostSocket: socket,
            slides: []
        });
        socket.emit("host_create_session", { valid: true, code });

    });

    socket.on("host_control_session", (data) => {
        const {code} = data;
        const applicableSession = activeSessions.filter(session => session.code.toUpperCase() == code.toUpperCase());
        if(applicableSession.length == 0){
            socket.emit("host_control_session", {valid: false});
            return;
        }
        const session = applicableSession[0];
        session.aliveUntil = new Date();
        session.hostSocket = socket;
        socket.emit("host_control_session", {valid: true, stateData: session.stateData, slides: session.slides, players: session.players, code: code.toUpperCase()});
    })

    socket.on("host_update_state", (data) => {
        const {code, stateData} = data;
        if(code == undefined || stateData == undefined){
            return;
        }
        const applicableSession = activeSessions.filter(session => session.code.toUpperCase() == code.toUpperCase());
        if(applicableSession.length == 0){
            return;
        }
        const session = applicableSession[0];
        session.aliveUntil = new Date();
        var resendAnswer = false;
        if(stateData.currentSlide.id != session.stateData.currentSlide.id){
            resendAnswer = true;
        }
        session.stateData = stateData;
        session.hostSocket.emit("host_update_state", {valid: true, stateData});
    

        io.to(code.toUpperCase()).emit("game_update_state", {valid: true, stateData, resendAnswer});

        
    })

    socket.on("game_my_answer", (data) => {
        if(socket.nickname == undefined){
            return;
        }
        var code = socket.nickname.split("@")[1];
        var username = socket.nickname.split("@")[0];
        const applicableSession = activeSessions.filter(session => session.code.toUpperCase() == code.toUpperCase());
        if(applicableSession.length == 0){
            return;
        }
        const session = applicableSession[0];
        var previousAnswer = session.stateData.answers[username];
        console.log(previousAnswer);
        if(previousAnswer != undefined){
            socket.emit("game_your_answer", {valid: true, answer: previousAnswer});
        }
    })

    socket.on("game_ping", (data) => {
        try{
            var code = socket.nickname.split("@")[1];
            const applicableSession = activeSessions.filter(session => session.code.toUpperCase() == code.toUpperCase());
            if(applicableSession.length == 0){
                return;
            
            }

            const session = applicableSession[0];

            socket.emit("game_update_state", {valid: true, stateData: session.stateData});
        }catch(e){

        }
        
    })

    socket.on("host_add_slide", (data) => {
        const {code, slide} = data;
        const applicableSession = activeSessions.filter(session => session.code.toUpperCase() == code.toUpperCase());
        if(applicableSession.length == 0){
            socket.emit("host_add_slide", {valid: false});
            return;
        }
        const session = applicableSession[0];
        session.aliveUntil = new Date();

        slide.id = generateUniqId();
        slide.submissions = [];


        session.slides.push(slide);
        
        session.hostSocket.emit("host_add_slide", {valid: true, slide});
    
    })





    socket.on('home_verify_code', (data) => {
        const {code} = data;
        const applicableSession = activeSessions.filter(session => session.code.toUpperCase() == code.toUpperCase());
        if(applicableSession.length == 0){
            socket.emit('home_verify_code', {valid: false});
        }else{
            socket.emit('home_verify_code', {valid: true, code: code.toUpperCase()});
        }
    });
    socket.on('home_join', (data) => {
        const {code, username} = data;
        const applicableSession = activeSessions.filter(session => session.code == code);
        if(applicableSession.length == 0){
            socket.emit('home_verify_code', {valid: false});
        }else{
            const session = applicableSession[0];
            if(session.players.filter(player => player.username == username).length > 0){
                socket.emit('home_join', {valid: false, message: "Username already taken!"});
                return;
            }
            session.players.push({
                username,
                lastSeen: new Date()
            });
            session.hostSocket.emit("host_update_players", {players: session.players});
            socket.nickname = username + "@" + code;
            socket.join(code.toUpperCase());
            socket.emit('home_join', {valid: true, stateData: session.stateData, code, username});
        }
    });
    socket.on('home_join_override', (data) => {
        const {code, username} = data;
        const applicableSession = activeSessions.filter(session => session.code == code);
        if(applicableSession.length == 0){
            return;
        }
        const session = applicableSession[0];
        socket.nickname = username + "@" + code;
        socket.join(code.toUpperCase());
        socket.emit('home_join', {valid: true, stateData: session.stateData, code, username});
    })

    socket.on('home_game_exists', (data) => {
        const {code, username} = data;
        const applicableSession = activeSessions.filter(session => session.code == code);
        if(applicableSession.length == 0){
            socket.emit('home_game_exists', {valid: false});
            return;
        }
        const session = applicableSession[0];
        if(session.players.filter(player => player.username == username).length > 0){
            socket.emit('home_game_exists', {valid: true, code, username});
            return;
        }
        socket.emit('home_game_exists', {valid: false});
    });

    socket.on('game_submit_answer', (data) => {
        const {answer} = data;
        if(socket.nickname == undefined){
            return;
        }
        var code = socket.nickname.split("@")[1];
        var username = socket.nickname.split("@")[0];
        const applicableSession = activeSessions.filter(session => session.code.toUpperCase() == code.toUpperCase());
        if(applicableSession.length == 0){
            return;
        }
        const session = applicableSession[0];
        if(!session.stateData.interaction.canRespond){
            return;
        }
        try{
            if(answer.includes("data:image") && session.stateData.currentSlide.type != "drawing")
                return;
        }catch(e){

        }
        
        session.stateData.answers[username] = answer;


        session.hostSocket.emit("host_update_answers", {valid: true, answers: session.stateData.answers});
    })


});



var activeSessions = [];
/*
{
    code: String (id),
    aliveUntil: Date,
    players: [{
        username: String,
        lastSeen: Date
    }],
    slides: [{
        id: String,
    }]
    stateData: Object,
    hostSocket: Socket
}


*/







const crypto = require('crypto');
const jwt = require('jsonwebtoken');
function hashPW(password){
    const salt = crypto.randomBytes(16).toString('hex');
    const pwHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { pwHash, salt };
}
function checkPW(password, pwHash, salt){
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === pwHash;
}

function genToken(user){
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);
    return jwt.sign({
        _id: user._id,
        username: user.username,
        exp: expires.getTime() / 1000
    }, 'jelly');
}
function validateToken(token){
    jwt.verify(token, 'jelly', (err, decoded) => {
        if (err) {
            console.error(err);
            return false;
        } else {
            return true;
        }
    });
}
function validateIdentity(req){
    const { token } = req.cookies;
    jwt.verify(token, 'jelly', (err, decoded) => {
        if (err) {
            console.error(err);
            return false;
        } else {
            return true;
        }
    });
}



app.post("/acc/register", async (req, res) => {
    const { username, email, password } = req.body;
    const { pwHash, salt } = hashPW(password);

    var existingUser = User.find({ username });
    if (existingUser.length > 0) {
        res.status(409).send("Username already exists");
        return;
    }

    const user = new User({
        username,
        email,
        pwHash,
        pwSalt: salt,
        type: 'creator'
    });

    user.save((err, user) => {
        if (err) {
            console.error(err);
            res.status(500).send(err);
        } else {
            user.pwHash = undefined;
            user.pwSalt = undefined;
            user.token = genToken(user);
            res.status(200).send(user);
        }
    });
});

app.post("/acc/login", async (req, res) => {
    const { username, password } = req.body;
    var applicableUser = User.find({ username });
    if (applicableUser.length == 0) {
        res.status(401).send("Login Failed");
    } else {
        const user = applicableUser[0];
        if (checkPW(password, user.pwHash, user.pwSalt)) {
            user.pwHash = undefined;
            user.pwSalt = undefined;
            user.token = genToken(user);
            res.status(200).send(user);
        } else {
            res.status(401).send("Login Failed");
        }
    }
});

app.post("/acc/validate", async (req, res) => {
    const { token } = req.body;
    if (validateToken(token)) {
        res.status(200).send("Valid");
    } else {
        res.status(401).send("Invalid");
    }
});

app.get("/board/:id", async (req, res) => {
    const { id } = req.params;
    const board = Board.find({ _id: id });
    if (board.length == 0) {
        res.status(404).send("Board not found");
    } else {
        res.status(200).send(board[0]);
    }
});

app.post("/board/create", async (req, res) => {
    if(!validateIdentity(req)){
        res.status(401).send("Invalid");
        return;
    }
    const { title, description, creator, slides, public } = req.body;
    const board = new Board({
        title,
        description,
        creator,
        createdAt: new Date(),
        slides,
        public
    });
    board.save((err, board) => {
        if (err) {
            console.error(err);
            res.status(500).send(err);
        } else {
            res.status(200).send(board);
        }
    });
});

app.post("/board/update", async (req, res) => {
    if(!validateIdentity(req)){
        res.status(401).send("Invalid");
        return;
    }
    const { id, title, description, slides, public } = req.body;
    const board = Board.find({ _id: id });
    if (board.length == 0) {
        res.status(404).send("Board not found");
    } else {
        board[0].title = title;
        board[0].description = description;
        board[0].slides = slides;
        board[0].public = public;
        board[0].save((err, board) => {
            if (err) {
                console.error(err);
                res.status(500).send(err);
            } else {
                res.status(200).send(board);
            }
        });
    }
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});