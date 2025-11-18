const axios = require('axios');
const AppError = require('../utils/errorHandling/AppError');

exports.validateAdminFromCentralAuth = async (req, res, next) => {
<<<<<<< HEAD
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token || token === 'null') { // <-- Added 'null' check
      return res.status(401).json({ status: "error", message: "Unauthorized" });
=======
    try {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token || token === 'null') { // <-- Added 'null' check
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
        //console.log(error);

        // --- 1. THIS IS THE FIX ---
        // Check if the error is from the axios call (Heroku)
        if (error.response && error.response.status === 401) {
          // Pass the 401 error to the frontend
          return res.status(401).json({
            status: "fail",
            message: "You are not authorized to access this resource",
          });
        }
        // --- END OF FIX ---

      // If it's some other error, then it's a 500
      return next(new AppError(500, "Internal Server Error."));
>>>>>>> 691825bdbb83d6c68f124a8753340e660a5606c2
    }

    const authResponse = await axios.get(
      `${process.env.AUTH_URL}/api/v1/auth/validateAdmin`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const { data } = authResponse;

    if (data?.status === "fail") {
      return res.status(400).json({
        status: "error",
        message: data?.message
      });
    }

    //console.log(data);

    req.user = data?.data;
    next()
  } catch (error) {
    //console.log(error);

    // --- 1. THIS IS THE FIX ---
    // Check if the error is from the axios call (Heroku)
    if (error.response && error.response.status === 401) {
      // Pass the 401 error to the frontend
      return res.status(401).json({
        status: "fail",
        message: "You are not authorized to access this resource",
      });
    }
    // --- END OF FIX ---

    // If it's some other error, then it's a 500
    return next(new AppError(500, "Internal Server Error."));
  }
}
