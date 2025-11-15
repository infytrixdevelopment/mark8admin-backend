const axios = require('axios');
const AppError = require('../utils/errorHandling/AppError');

exports.validateAdminFromCentralAuth = async (req, res, next) => {
    try {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token) {
        return res.status(401).json({ status: "error", message: "Unauthorized" });
      }
  
      const authResponse = await axios.get(
        `${process.env.AUTH_URL}/api/v1/auth/validateAdmin`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const { data } = authResponse;

      if (data?.status === "fail") {
        return res.status(401).json({
          status: "fail",
          message: "You are not authorized to access this resource",
        });
      }
      
      console.log(data);
  
      req.user = data?.data;
      next()
    } catch (error) {
        console.log(error);
      return next(new AppError(500, "Internal Server Error."));
    }
  }