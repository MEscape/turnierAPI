const express = require('express')
const https = require('https')
const fs = require('fs')
const cors = require('cors')
const sqlite3 = require('sqlite3').verbose()
const crypto = require('crypto')
const WebSocket = require('ws')
const app = express()

app.use(express.json())
app.use(cors())

let sessions = new Set()
let finished = new Set()
let playerCount = 0
let started = false
let currentVisit = {one: null, two: null}

//Verschlüsselung
const options = {
    key: fs.readFileSync('private-key.pem'),
    cert: fs.readFileSync('certificate.pem')
};

//Create Server
const server = https.createServer(options, app);
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)

        //Client ID-Vergabe
        ws.on('message', async (message) => {
            let messageStr = message.toString()
            let parsedMessage = JSON.parse(messageStr)

            if(parsedMessage.key !== undefined) {
                ws.id = parsedMessage.key

                if(parsedMessage.key !== 'MASTERme8sc5es3') {
                    try {
                        const result = await selectDB(parsedMessage.key, 'name', 'key')
                
                        if(result !== null && result !== undefined) {
                            sendSpecific('MASTERme8sc5es3', JSON.stringify({ name: result.name }))
                        }
                    } catch(err) {
                        console.error(err)
                    }
                }
            }

            if(parsedMessage.ready !== undefined) {
                try {
                    const result = await selectDB(parsedMessage.ready, 'name', 'key')
            
                    if(result !== null && result !== undefined) {
                        sendSpecific('MASTERme8sc5es3', JSON.stringify({ ready: result.name }))
                    }
                } catch(err) {
                    console.error(err)
                }
            }

            if(parsedMessage.action !== undefined) {
                if(parsedMessage.action === 'startGame') {
                    started = true
                    const pairs = await randomSelection()
                    sendAll(JSON.stringify({ action: parsedMessage.action, pairs: pairs }))
                }
                if(parsedMessage.action === 'startRound') {
                    const gamemode = await getRandomGameMode()
                    sendAll(JSON.stringify({ action: parsedMessage.action, gamemode: gamemode, time: parsedMessage.time, currentTime: Date.now() }))
                }
            }

            if(parsedMessage.editor !== undefined) {
                if(parsedMessage.partner !== undefined) {
                    sendSpecific(parsedMessage.partner, JSON.stringify({ editor: parsedMessage.editor }))
                } else {
                    sendSpecific('MASTERme8sc5es3', JSON.stringify({ editor: 
                    sessions.has(parsedMessage.own) ? parsedMessage.editor : '', own: parsedMessage.own }))
                }
            }

            if(parsedMessage.finished !== undefined) {
                if(!finished.has(parsedMessage.finished)) {
                    finished.add(parsedMessage.finished)
                    sendSpecific('MASTERme8sc5es3', JSON.stringify({ alreadyFinished: finished.size, possible: sessions.size}))
                }
                
                if(finished.size === sessions.size) 
                    sendAll(JSON.stringify({ roundEnd: 'roundEnd' }))
            }

            if(parsedMessage.cheated !== undefined) {
                sendSpecific('MASTERme8sc5es3', JSON.stringify({ cheated: parsedMessage.cheated }))
            }

            if(parsedMessage.visit !== undefined) {
                currentVisit.one = parsedMessage.visit.one
                sendSpecific(parsedMessage.visit.one, JSON.stringify({ editor: 'GET' }))
                if(parsedMessage.visit.two !== null) {
                    currentVisit.two = parsedMessage.visit.two
                    sendSpecific(parsedMessage.visit.two, JSON.stringify({ editor: 'GET' }))
                }
            }

            if(parsedMessage.stopTransfer !== undefined) {
                currentVisit.one = null
                sendSpecific(currentVisit.one, JSON.stringify({ editor: 'STOP' }))
                if(currentVisit.two !== null) {
                    currentVisit.two = null
                    sendSpecific(currentVisit.two, JSON.stringify({ editor: 'STOP' }))
                }
            }

            if(parsedMessage.ratingPoints !== undefined) {
                sendSpecific(parsedMessage.keyRight, JSON.stringify({ pos: 'right', ratingPoints: parsedMessage.ratingPoints }))
                if(parsedMessage.keyLeft !== null) {
                    sendSpecific(parsedMessage.keyLeft, JSON.stringify({ pos: 'left', ratingPoints: parsedMessage.ratingPoints }))
                }
            }

            if(parsedMessage.votingEnd !== undefined) {
                if(parsedMessage.votingEnd !== null) {
                    sendSpecific(parsedMessage.votingEnd, JSON.stringify({ votingEnd: true}))
                    deleteSpecific(parsedMessage.votingEnd)
                    sessions.delete(parsedMessage.votingEnd)
                    playerCount--
                }
                if(parsedMessage.votingContinue !== null)
                    sendSpecific(parsedMessage.votingContinue, JSON.stringify({ votingEnd: false}))
            }

            if(parsedMessage.allVotingFinished !== undefined) {
                finished.clear()
                const newPairs = processPairs(parsedMessage.allVotingFinished)
                
                if(newPairs.length === 1 && (newPairs[0].one === null || newPairs[0].two === null)) {
                    if(newPairs[0].one === null) {
                        sendAll(JSON.stringify({ winner: newPairs[0].two }))
                    } else {
                        sendAll(JSON.stringify({ winner: newPairs[0].one }))
                    }
                } else {
                    sendAll(JSON.stringify({ newPairs: newPairs }))
                }
            }
        })
    })
})
server.listen(3000, () => console.log('Secure server running on port 3000'))

//Erstellen WebSocket-Server
const wss = new WebSocket.Server({
    noServer: true,
    handlePreflightRequest: (req, res) => {
        const headers = {
            'Access-Control-Allow-Ori2gin': req.headers.origin,
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Credentials': true
        };
        res.writeHead(200, headers)
        res.end()
    }
})

//Pairs neu zusammensetzen
const processPairs = (pairData) => {
    const half = Math.floor(pairData.length / 2)
    const halfs = [pairData.slice(0, half), pairData.slice(half)]
    let newPairs = []

    halfs.forEach(part => {
        part.forEach((pair, i) => {
            if(i % 2 === 0) {
                let newPair = {one: null, two: null}
    
                for(let keyAttr in pair) {
                    if(pair[keyAttr] !== null) {
                        if(sessions.has(pair[keyAttr].key)) {
                            newPair.one = pair[keyAttr]
                        }
                    }
                    if(part.length > i+1) {
                        if(part[i+1][keyAttr] !== null) {
                            if(sessions.has(part[i+1][keyAttr].key)) {
                                newPair.two = part[i+1][keyAttr]
                            }
                        }
                    }
                }
                newPairs.push(newPair)
            }
        })
    })

    if(newPairs.length === 2 && (newPairs[0].one === null || newPairs[0].two === null) && (newPairs[1].one === null || newPairs[1].two === null)) {
        let newPair = {one: null, two: null}

        if(newPairs[0].two === null) {
            newPair.one = newPairs[0].one
        } else {
            newPair.one = newPairs[0].two
        }

        if(newPairs[1].two === null) {
            newPair.two = newPairs[1].one
        } else {
            newPair.two = newPairs[1].two
        }

        newPairs = []
        newPairs.push(newPair)
    }

    return newPairs
}

//Öffnen DB
let db = new sqlite3.Database('keys.sqlite', (err) => {
    if (err) {
        console.error(err.message)
    } else {
        console.log('Connected to the database.')
    }
})

//Gamemode
const getRandomGameMode = () => {
    return new Promise((resolve, reject) => {
      const query = `SELECT discounter, kategory, budget
                     FROM gamemodes 
                     WHERE discounter IS NOT NULL 
                     AND kategory IS NOT NULL 
                     AND budget IS NOT NULL 
                     ORDER BY RANDOM() 
                     LIMIT 1`
  
      db.get(query, (err, row) => {
        if (err) {
          console.error(err.message);
          reject(undefined);
        }
        if (row) {
          resolve(row);
        } else {
          resolve(null);
        }
      });
    });
  }

//Select from DB
const selectDB = (keyword, column, attribute) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT ${column} FROM keys WHERE ${attribute} = ?`, [keyword], (err, row) => {
            if(err) {
                console.error(err.message);
                reject(undefined);
            }
            if(row) {
                resolve(row);
            } else {
                resolve(null);
            }
        });
    });
}

//Updatet Wartende User
const updateUsers = async (left, key) => {
    if(left) {
        try {
            const result = await selectDB(key, 'name', 'key')
    
            if(result !== null && result !== undefined) {
                sendSpecific('MASTERme8sc5es3', JSON.stringify({ name: `left-${result.name}` }))
            }
        } catch(err) {
            console.error(err)
        }
    }

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ playerCount: playerCount }))
        }
    })
}


//RandomKey
const randomKey = (key, res) => {
    let randKey

    while(true) {
        randKey = crypto.randomBytes(8).toString('hex')

        if(key !== randKey)
            break
    }
    
    res.json({ key: randKey })
}

//Login
app.post('/check-access', async (req, res) => {
    const { key } = req.body

    try {
        const result = await selectDB(key, 'key, name, youtuber, logo', 'key')

        if(result !== null && result !== undefined) {
            if(clientExist('MASTERme8sc5es3')) {
                if (sessions.has(key)) {
                    res.json({ key: 'INUSE' })
                } else if(started) {
                    res.json({ key: 'STARTED' })
                } else {
                    sessions.add(key);
                    playerCount++
        
                    res.json({ key: key, meta: result })
                }
            } else {
                res.json({ key: 'NOTAVAILABLE' })
            }
        } else if(result === null) {
            randomKey(key, res)
        }
    } catch(err) {
        console.error(err)
    }
})

//Update Player
app.post('/update-player', () => {
    updateUsers(false, '')
})

//Get Playercount
app.get('/get-player', (req, res) => {
    res.json({ playerCount: playerCount })
})

//Logout
app.post('/log-out', (req, res) => {
    const { key } = req.body
    sessions.delete(key)
    deleteSpecific(key)
    updateUsers(true, key)

    if(playerCount > 0)
        playerCount--

    res.end()
})

//Remove Player
app.post('/remove-player', async (req, res) => {
    const { target } = req.body
    try {
        const result = await selectDB(target, 'key', 'name')
        await sendSpecific(result.key, JSON.stringify({ refresh: 'refresh' }))
        sessions.delete(result.key)
        deleteSpecific(result.key)
        updateUsers(true, result.key)
        playerCount--
    } catch (err) {
        console.error(err)
    }

    res.end()
})

//Specific Player Message
const sendSpecific = async (name, message) => {
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && client.id === name) {
            client.send(message)
        }
    }
}

//Delete Player
const deleteSpecific = async (name) => {
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && client.id === name) {
            client.close()
        }
    }
}

//All Player Message
const sendAll = (message) => {
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message)
        }
    }
}

//Client Exists
const clientExist = (key) => {
    let exists = false

    wss.clients.forEach(client => {
        if(client.id === key) 
            exists = true
    })

    return exists
}

//Rand Int
const getRandomInt = (max) => {
    return Math.floor(Math.random() * max);
  }

//Select Pairs for Game
const randomSelection = async () => {
    let newUsers = []

    let users = Array.from(wss.clients)
    .filter(client => client.readyState === WebSocket.OPEN && client.id !== 'MASTERme8sc5es3')
    .map(client => client.id)

    let rest = false
    let usersLength = users.length

    if(usersLength % 2 !== 0) {
        rest = true
    }

    while(usersLength > 0) {
        newUsers.push(await getRandomPair(usersLength, users))
        usersLength = users.length - 1
    }

    if(rest) {
        const result = await selectDB(users[0], 'name, youtuber, logo, key','key')
        newUsers.push({ one: { name: result.name, youtuber: result.youtuber, logo: result.logo, key: result.key }, two: null })
    }

    return newUsers
}

//Only one Type
const condition = async (users, value) => {
    let youtuber = 0

    for (let user of users) {
        youtuber += parseInt((await selectDB(user, 'youtuber','key')).youtuber)
    }

    return youtuber === value
}

//Rand User
const getRandomUser = async (usersLength, users) => {
    const randomNum = getRandomInt(usersLength)
    const randomKey = users[randomNum]
    const user = await selectDB(randomKey, 'name, youtuber, logo, key','key')

    return {user: user, num: randomNum}
}

//Rand Pair
const getRandomPair = async (usersLength, users) => { 
    try {
        const pair = {one: undefined, two: undefined}

        const first = await getRandomUser(usersLength, users)
        pair.one = first.user
        users.splice(first.num, 1)
        
        let i = 0

        while(true) {
            i++
            const second = await getRandomUser(users.length, users)

            if(pair.one.youtuber == 1 && second.user.youtuber == 0 || 
                second.user.youtuber == 1 && pair.one.youtuber == 0 || 
                await condition(users, 0) || await condition(users, users.length) || i === 100) {

                pair.two = second.user
                users.splice(second.num, 1)

                return pair
            }
        }
    } catch (err) {
        console.error(err)
    }
}