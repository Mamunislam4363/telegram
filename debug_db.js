const db = require('./db');
db.dbReady.then(() => {
    const users = Object.keys(db.data.users);
    console.log(`Current Users Count: ${users.length}`);
    if (users.length > 0) {
        console.log(`First User: ${JSON.stringify(db.data.users[users[0]])}`);
    }
    process.exit(0);
});
