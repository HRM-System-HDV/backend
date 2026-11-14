"use strict";
const service = require("../services/IntegrationService");
const {actor} = require("../utils/access");
const handler = (fn,status=200) => async (req,res,next) => { try { res.status(status).json({data:await fn(req,req.actor || actor(req))}); } catch(error) {next(error);} };
module.exports={handler,service};
