const jwt = require("jsonwebtoken")
require("dotenv").config({ path: "./config.env" });
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY;

const authenticateToken = (req,res,next) =>{
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]

    if (token == null){
        return res.sendStatus(401)
    }

    jwt.verify(token,JWT_SECRET_KEY,(req,res) => {
        if(err){
            return res.sendStatus(403)
        }

        req.user = user;
        next();
    })
}

module.exports = authenticateToken