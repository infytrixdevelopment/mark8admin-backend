const bcrypt = require("bcrypt");

exports.hashPassword = async (plainTextPassword) => {
      try {
        const hashedPassword = await bcrypt.hash(plainTextPassword, 10);
        return { status: true, hashedPassword }
      } catch (error) {
        return { status: false, message: "Unable to hash password." }
      }
    }
