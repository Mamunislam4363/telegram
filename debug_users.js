const db = require('./db');
db.dbReady.then(() => {
    const users = Object.values(db.data.users);
    console.log(`Current Users Count: ${users.length}`);
    users.forEach(u => {
        console.log(`User ID: ${u.id}, Name: ${u.firstName || u.username}, Tokens: ${db.getTokenBalance(u)}`);
    });
    process.exit(0);
});
