const express = require("express");
const mysql = require("mysql2/promise"); // Use promise-based mysql2
require("dotenv").config({ path: "./config.env" });
const authenticateToken = require("./authenticateToken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const saltRounds = 10;
const fs = require("fs");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const otpGenerator = require("otp-generator"); // Install this package for OTP generation
const { message } = require("antd");

// Twilio client setup
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const razorpay = new Razorpay({
  key_id: "rzp_test_o4CCSfsu759r6s",
  key_secret: "MsbWUaXOMmwDsSqsUQyXnn2E",
});

const app = express();
app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded bodies

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY;

// Create a promise-based connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Connect to MySQL
connection
  .then(() => {
    console.log("Connected to MySQL database");
  })
  .catch((err) => {
    console.error("Error connecting to MySQL:", err);
  });

// ========================================================================================================


app.post("/create-order", async (req, res) => {
  const {
    amount,
    currency,
    receipt,
    mobile,
    email,
    pricing_plan,
    payment_method,
  } = req.body;

  // Create the order object for Razorpay
  const options = {
    amount: amount * 100, // Convert to the smallest unit (paise for INR)
    currency,
    receipt,
    payment_capture: 1, // Auto capture after payment success
  };

  try {
    // Check if the email or mobile already exists in the 'orders' table
    const checkUserSql = `SELECT * FROM orders WHERE email = ? OR mobile = ?`;
    const [existingUsers] = await (
      await connection
    ).execute(checkUserSql, [email, mobile]);

    if (existingUsers.length > 0) {
      // If the email or mobile exists, return an error
      return res.status(400).json({ error: "Email or mobile already exists" });
    }

    // Create an order in Razorpay
    const order = await razorpay.orders.create(options);

    // After successfully creating the Razorpay order, insert data into the database
    const insertOrderSql = `INSERT INTO orders (receipt, amount, mobile, email, pricing_plan, currency, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    // Execute the insert query
    const [result] = await (
      await connection
    ).execute(insertOrderSql, [
      receipt,
      amount,
      mobile,
      email,
      pricing_plan,
      currency,
      payment_method,
    ]);

    console.log("Order inserted into database:", result);

    // Send the Razorpay order details as a response
    res.status(200).json(order);
  } catch (err) {
    console.log("Error creating order:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});





// API endpoint to verify payment signature
app.post("/verify-payment", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  const generated_signature = crypto
    .createHmac("sha256", "MsbWUaXOMmwDsSqsUQyXnn2E")
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generated_signature === razorpay_signature) {
    res.status(200).json({ status: "success" });
  } else {
    res.status(400).json({ status: "failed" });
  }
});

// Show projects linked to companies
app.get("/project/:company_id", async (req, res) => {
  const company_id = req.params.company_id;

  // 1) Define the SQL string exactly:
  const getAllProjectsSQL = `
    SELECT
      project_id,
      project_name,
      project_total_members,
      project_desc
    FROM
      project
    WHERE
      company_id_project = ?
  `;

  try {
    // 2) Use (await connection).execute(...) to run the parameterized query:
    const [results] = await (await connection).execute(getAllProjectsSQL, [
      company_id,
    ]);

    // 3) Send back the array of projects:
    return res.json(results);
  } catch (err) {
    console.error("Error in /project/:company_id →", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch projects for company_id=" + company_id });
  }
});

//get all the details of a company
app.get("/getCompanyDetail/:company_id", async (req, res) => {
  const company_id = req.params.company_id;
  const getAllCompany = "select * from company_list where company_id = ?";
  try {
    const [results] = await (
      await connection
    ).execute(getAllCompany, [company_id]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch the project" });
  }
});

//delete the project in a company
app.delete("/deleteComapny/:project_id", async (req, res) => {
  const project_id = req.params.project_id;
  const deleteProject = "delete from project where project_id = ?";
  try {
    const [results] = await (
      await connection
    ).execute(deleteProject, [project_id]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch the project" });
  }
});

//insert project to company
app.post("/insertProject/:company_id", async (req, res) => {
  const company_id = req.params.company_id;
  const { project_name, project_total_members, project_desc } = req.body;
  const insertProject =
    "insert into project (project_name,project_total_members,project_desc,company_id_project) values (?,?,?,?)";

  try {
    const [results] = await (
      await connection
    ).execute(insertProject, [
      project_name,
      project_total_members,
      project_desc,
      company_id,
    ]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to insert the project" });
  }
});

// Insert members in projects
app.post("/insertmember/:projId", authenticateToken, async (req, res) => {
  const projId = req.params.projId;
  const { project_name, project_total_members, project_desc } = req.body;
  const insertmember =
    "insert into project ( project_name , project_total_members, project_desc, company_id_project) values (?,?,?,? )";

  try {
    const [results] = await (
      await connection
    ).execute(insertmember, [
      project_name,
      project_total_members,
      project_desc,
      projId,
    ]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to insert the project" });
  }
});

//upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads");
  },
  filename: (req, file, cb) => {
    const uniquesuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniquesuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

//register to the company
app.post("/registerCompany", upload.single("logo"), async (req, res) => {
  const {
    company_name,
    owners_count,
    total_member,
    phone,
    establishment_date,
    email,
    password,
  } = req.body;
  const logo = req.file ? req.file.path : null;

  if (!password) {
    return res.status(400).json({ message: "Password is required" });
  }

  try {
    // Check if the email and phone exist in the orders table
    const [orderCheck] = await (
      await connection
    ).execute(
      "SELECT COUNT(*) AS count FROM orders WHERE email = ? AND mobile = ?",
      [email, phone]
    );

    if (orderCheck[0].count === 0) {
      return res
        .status(400)
        .json({
          message: "Please use the email or mobile which is used in payment",
        });
    }

    // Check if the email or phone already exists in the company_list table
    const [companyCheck] = await (
      await connection
    ).execute(
      "SELECT COUNT(*) AS count FROM company_list WHERE phone = ? OR email = ?",
      [phone, email]
    );

    if (companyCheck[0].count > 0) {
      return res.status(400).json({
        message: "Phone number or email already exists in company records",
      });
    }

    // Encrypt the password
    const encryptedPassword = await bcrypt.hash(password, saltRounds);

    // Insert the new company record
    const [results] = await (
      await connection
    ).execute(
      "INSERT INTO company_list (company_name, owners_count, total_member, phone, logo, establishment_date, email, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        company_name,
        owners_count,
        total_member,
        phone,
        logo,
        establishment_date,
        email,
        encryptedPassword,
      ]
    );

    res.status(201).json({ message: "Registration successful" });
  } catch (error) {
    console.error("Error registering the company:", error);
    res.status(500).json({ message: "Failed to register the company" });
  }
});

//========== eomployeer login logic ================
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const loginquery = "SELECT * FROM company_list WHERE email = ?";

  try {
    const [results] = await (await connection).execute(loginquery, [email]);
    const user = results[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid user" });
    }

    const isPassValid = await bcrypt.compare(password, user.password);
    if (!isPassValid) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { email: user.email, id: user.company_id },
      JWT_SECRET_KEY,
      { expiresIn: "1h" }
    );

    // Include the company profile in the response
    res.json({
      token,
      companyProfile: {
        company_id: user.company_id,
        company_name: user.company_name,
        owners_count: user.owners_count,
        total_member: user.total_member,
        logo: user.logo,
        establishment_date: user.establishment_date,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
    console.log("failed");
  }
});

app.post("/send-otp", async (req, res) => {
  const { phone_number } = req.body;
  const otp = otpGenerator.generate(6, {
    digits: true,
    upperCase: false,
    specialChars: false,
  });
  const expires_at = new Date(Date.now() + 15 * 60 * 1000); // OTP valid for 15 minutes

  const insertOtpQuery =
    "INSERT INTO otps (phone_number, otp, expires_at) VALUES (?, ?, ?)";

  try {
    await (
      await connection
    ).execute(insertOtpQuery, [phone_number, otp, expires_at]);

    // Send OTP via Twilio
    await twilioClient.messages.create({
      body: `Your OTP is ${otp}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone_number,
    });

    res.json({ message: "OTP sent successfully" });
  } catch (error) {
    res.status(500).json({ error: "Otp not sent" });
  }
});

// OTP verification
app.post("/verify-otp", async (req, res) => {
  const { phone_number, otp } = req.body;

  const verifyOtpQuery =
    "SELECT * FROM otps WHERE phone_number = ? AND otp = ? AND expires_at > NOW()";

  try {
    const [results] = await (
      await connection
    ).execute(verifyOtpQuery, [phone_number, otp]);

    if (results.length === 0) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    res.json({ message: "OTP verified successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to verify OTP" });
  }
});

// Password update
app.post("/update-password", async (req, res) => {
  const { phone, password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "New password is required" });
  }

  try {
    const encryptedPassword = await bcrypt.hash(password, saltRounds);
    const updatePasswordQuery =
      "UPDATE company_list SET password = ? WHERE phone = ?";

    await (
      await connection
    ).execute(updatePasswordQuery, [encryptedPassword, phone]);
    res.json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update password" });
    console.log(error);
  }
});

app.get("/insert/:company_id", async (req, res) => {
  const company_id = req.params.company_id;
  const getAllCompany = "select * from company_list where company_id = ?";
  try {
    const [results] = await (
      await connection
    ).execute(getAllCompany, [company_id]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch the project" });
  }
});

//get all project details
app.get("/getProjDet/:project_id", async (req, res) => {
  const project_id = req.params.project_id; // Correctly access the project_id

  const getQuery = "SELECT * FROM project WHERE project_id = ?";
  try {
    const [results] = await (await connection).execute(getQuery, [project_id]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch the project" });
    console.log(error);
  }
});

//get the total employee in a paticular project
app.get("/countEmp/:project_id", async (req, res) => {
  const project_id = req.params.project_id; // Correctly access the project_id

  const getQuery =
    "SELECT COUNT(*) AS total_employees FROM employee WHERE emp_id_project = ?";
  try {
    const [results] = await (await connection).execute(getQuery, [project_id]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to count" });
    console.log(error);
  }
});

//insert any employee in a project
app.post("/insertEmpProj/:project_id", async (req, res) => {
  const project_id = req.params.project_id;
  const { employee_name } = req.body;
  const insertQuery =
    "insert into employee (employee_name,emp_id_project) values (?,?)";
  try {
    const [results] = await (
      await connection
    ).execute(insertQuery, [employee_name, project_id]);
    res.status(201).send({ message: "Employee inserted successfuly" });
  } catch (error) {
    res.status(500).json({ error: "Failed to insert" });
    console.log(error);
  }
});

//show the employee in a particular project
app.get("/getEmpFromProj/:emp_id_project", async (req, res) => {
  const emp_id_project = req.params.emp_id_project;
  const QueryProj = "select * from employee where emp_id_project = ?";

  try {
    const [results] = await (
      await connection
    ).execute(QueryProj, [emp_id_project]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to show" });
    console.log(error);
  }
});

const getCurrentDate = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based in JavaScript
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

//show working hour of current Date
app.get("/getCurrentHour/:emp_id", async (req, res) => {
  const emp_id = req.params.emp_id;
  const queryGetHour =
    "SELECT `working_hour` FROM `timesheet`WHERE `timesheet_emp_id` = ? AND DATE(`date_time_stamp`) = ? ";
  try {
    const [results] = await (
      await connection
    ).execute(queryGetHour, [emp_id, getCurrentDate()]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch" });
  }
});

//Fetch working hour of any single day
app.get("/getSingleDayHour/:emp_id/:getSingleDate", async (req, res) => {
  const emp_id = req.params.emp_id;
  const getSingleDate = req.params.getSingleDate;
  const queryGetHour =
    "SELECT `working_hour` FROM `timesheet` WHERE `timesheet_emp_id` = ? AND DATE(`date_time_stamp`) = ?";

  try {
    const [results] = await (
      await connection
    ).execute(queryGetHour, [emp_id, getSingleDate]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch" });
  }
});

//update the details of an employee
app.put("/updateEmployee/:employee_id", async (req, res) => {
  const employee_id = req.params.employee_id;
  const { employee_name, work_detail } = req.body;

  const queryUpdateEmployee =
    "UPDATE `employee` SET `employee_name` = ?, `work_detail` = ? WHERE `employee_id` = ?";

  try {
    const [results] = await (
      await connection
    ).execute(queryUpdateEmployee, [employee_name, work_detail, employee_id]);

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.send({ message: "Employee details updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update employee details" });
    console.log(error);
  }
});

//fetch working hour between range dates
app.get(
  "/getWorkingHourRange/:emp_id/:FirstDate/:secondDate",
  async (req, res) => {
    const emp_id = req.params.emp_id;
    const FirstDate = req.params.FirstDate;
    const secondDate = req.params.secondDate;

    const queryGetHour = `
    SELECT SEC_TO_TIME(SUM(TIME_TO_SEC(working_hour))) AS total_working_hours 
    FROM timesheet 
    WHERE STR_TO_DATE(date_time_stamp, '%Y-%m-%d') BETWEEN STR_TO_DATE(?, '%Y-%m-%d') 
    AND STR_TO_DATE(?, '%Y-%m-%d') 
    AND timesheet_emp_id = ?;
  `;

    try {
      // const [results] = await connection.execute(queryGetHour, [FirstDate, secondDate, emp_id]);
      const [results] = await (
        await connection
      ).execute(queryGetHour, [FirstDate, secondDate, emp_id]);
      res.send(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch" });
      console.log(error);
    }
  }
);

//fetch leave balance
app.get("/leaveBalance/:employee_id", async (req, res) => {
  const employee_id = req.params.employee_id;
  const balanceQuery =
    "select * from leave_balance where leave_balance_emp_id = ?";

  try {
    const [results] = await (
      await connection
    ).execute(balanceQuery, [employee_id]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch" });
    console.log(error);
  }
});

//fetch the leave_applied for an employee
app.get("/appliedLeave/:employee_id", async (req, res) => {
  const employee_id = req.params.employee_id;
  const balanceQuery =
    "SELECT *  FROM leave_applied WHERE emp_id = ? ORDER BY status ASC;";
  try {
    const [results] = await (
      await connection
    ).execute(balanceQuery, [employee_id]);
    res.send(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch" });
    console.log(error);
  }
});

// Approve leave by updating the status
app.post("/approveLeave/:leave_Applied_id", async (req, res) => {
  const leave_Applied_id = req.params.leave_Applied_id;

  // Get the applied leave details
  const getLeaveDetailsQuery = `
    SELECT emp_id, type_of_leave, numberOfDays
    FROM leave_applied 
    WHERE leave_Applied_id = ?
  `;

  try {
    // Fetch the applied leave details
    const [leaveDetailsResults] = await (
      await connection
    ).execute(getLeaveDetailsQuery, [leave_Applied_id]);

    if (leaveDetailsResults.length === 0) {
      return res.status(404).json({ error: "Leave application not found" });
    }

    const { emp_id, type_of_leave, numberOfDays } = leaveDetailsResults[0];

    // Determine the correct column for the leave type (earned, sick, flexi, casual)
    let leaveColumn;
    switch (type_of_leave) {
      case "earned":
        leaveColumn = "earned";
        break;
      case "sick":
        leaveColumn = "sick";
        break;
      case "flexi":
        leaveColumn = "flexi";
        break;
      case "casual":
        leaveColumn = "casual";
        break;
      default:
        return res.status(400).json({ error: "Invalid leave category" });
    }

    // Query to update the leave balance in the specific category
    const updateLeaveBalanceQuery = `
      UPDATE leave_balance 
      SET ${leaveColumn} = ${leaveColumn} - ?
      WHERE leave_balance_emp_id = ?
    `;

    // Update the leave balance for the employee
    await (
      await connection
    ).execute(updateLeaveBalanceQuery, [numberOfDays, emp_id]);

    // Approve the leave by updating the status
    const approveLeaveQuery = `
      UPDATE leave_applied 
      SET status = 1 
      WHERE leave_Applied_id = ?
    `;

    await (await connection).execute(approveLeaveQuery, [leave_Applied_id]);

    res.json({ message: "Leave approved and leave balance updated" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Failed to approve leave" });
  }
});

// Delete leave request
app.delete("/deleteLeave/:leave_applied_id", async (req, res) => {
  const leave_applied_id = req.params.leave_applied_id;
  const deleteQuery = "DELETE FROM leave_applied WHERE leave_applied_id = ?";

  try {
    const [result] = await (
      await connection
    ).execute(deleteQuery, [leave_applied_id]);
    res.json({ message: "Leave deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete leave" });
    console.log(error);
  }
});

// add an employee to a project
// add an employee to a project (and immediately create a leave_balance row)
app.post("/AddEmpProj/:proj_id", async (req, res) => {
  const proj_id = req.params.proj_id;
  const { employee_id, employee_name, emp_contact, work_detail, password } = req.body;

  // 1) Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // 2) We need a Connection object to run a transaction
  const conn = await connection;
  try {
    await conn.beginTransaction();

    // 3) Insert into employee (using the provided employee_id)
    const insertEmpSQL =
      "INSERT INTO employee (employee_id, employee_name, emp_id_project, emp_contact, work_detail, password) VALUES (?, ?, ?, ?, ?, ?)";
    await conn.execute(insertEmpSQL, [
      employee_id,
      employee_name,
      proj_id,
      emp_contact,
      work_detail,
      hashedPassword,
    ]);

    // 4) Now insert the default leave_balance row for this new employee
    const insertLBSQL =
      "INSERT INTO leave_balance (earned, sick, flexi, casual, leave_balance_emp_id) VALUES (?, ?, ?, ?, ?)";
    // defaults: earned=5, sick=10.0, flexi=10.0, casual=12.0
    await conn.execute(insertLBSQL, [5, 10.0, 10.0, 12.0, employee_id]);

    // 5) Commit both inserts together
    await conn.commit();
    res.status(201).json({ message: "Employee added and leave_balance created" });
  } catch (error) {
    // On any error, roll back so you don't end up with half‐written data
    await conn.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Duplicate entry: Employee ID already exists" });
    }
    console.error("Error in /AddEmpProj:", error);
    res.status(500).json({ error: "Failed to insert employee or leave_balance" });
  }
});



//delete a employee from a particular project
app.delete("/deleteEmp/:employee_id", async (req, res) => {
  const employee_id = req.params.employee_id;

  try {
    // 1) Disable foreign‐key checks on the single connection:
    await (await connection).query("SET FOREIGN_KEY_CHECKS = 0");

    // 2) Perform the DELETE using the same connection:
    const deleteQuery = "DELETE FROM employee WHERE employee_id = ?";
    const [result] = await (await connection).execute(deleteQuery, [employee_id]);

    // 3) Re‐enable foreign‐key checks on the same connection:
    await (await connection).query("SET FOREIGN_KEY_CHECKS = 1");

    // 4) Send back the result (or a success message):
    return res.json({ message: "Employee deleted successfully", result });
  } catch (err) {
    // If anything fails, try to re‐enable FK checks before returning the error:
    try {
      await (await connection).query("SET FOREIGN_KEY_CHECKS = 1");
    } catch (_) {
      // ignore any secondary error
    }
    console.error("Error in /deleteEmp/:employee_id →", err);
    return res.status(500).json({ error: "Failed to delete employee" });
  }
});


// get timesheet info from a date stamp
app.get("/getInfoTimesheet/:date/:timesheet_emp_id", async (req, res) => {
  const date = req.params.date;
  const timesheet_emp_id = req.params.timesheet_emp_id;

  const query =
    "select * from timesheet where date_time_stamp = ? and timesheet_emp_id = ? ";
  try {
    const [result] = await (
      await connection
    ).execute(query, [date, timesheet_emp_id]);
    res.send(result);
  } catch (error) {
    res.status(500).json({ error: "Failed " });
    console.log(error);
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const loginquery = "SELECT * FROM company_list WHERE email = ?";

  try {
    const [results] = await (await connection).execute(loginquery, [email]);
    const user = results[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid user" });
    }

    const isPassValid = await bcrypt.compare(password, user.password);
    if (!isPassValid) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { email: user.email, id: user.company_id },
      JWT_SECRET_KEY,
      { expiresIn: "1h" }
    );

    // Include the company profile in the response
    res.json({
      token,
      companyProfile: {
        company_id: user.company_id,
        company_name: user.company_name,
        owners_count: user.owners_count,
        total_member: user.total_member,
        logo: user.logo,
        establishment_date: user.establishment_date,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
    console.log("failed");
  }
});

//employee login
// app.post("/api/emplogin", async (req, res) => {
//   const { employee_id, password } = req.body;
//   const loginquery = "SELECT * FROM employee WHERE employee_id = ?";

//   try {
//     const [results] = await (await connection).execute(loginquery, [employee_id]);
//     const user = results[0];

//     if (!user) {
//       return res.status(400).json({ error: "Invalid user" });
//     }

//     const isPassValid = await bcrypt.compare(password, user.password);
//     if (!isPassValid) {
//       return res.status(400).json({ error: "Invalid password" });
//     }

//     const token = jwt.sign(
//       { email: user.email, id: user.company_id },
//       JWT_SECRET_KEY,
//       { expiresIn: "1h" }
//     );

//     // Include the company profile in the response
//     res.json({
//       token,
//       companyProfile: {
//         company_id: user.company_id,
//         company_name: user.company_name,
//         owners_count: user.owners_count,
//         total_member: user.total_member,
//         logo: user.logo,
//         establishment_date: user.establishment_date,
//         email: user.email,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({ error: "Login failed" });
//     console.log("failed");
//   }
// });

app.post("/api/emplogin", async (req, res) => {
  const { employee_id, password } = req.body;
  const loginquery = "SELECT * FROM employee WHERE employee_id = ?";

  try {
    const [results] = await (
      await connection
    ).execute(loginquery, [employee_id]);
    const user = results[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid user" });
    }

    // Verify the hashed password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { employee_id: user.employee_id, emp_id_project: user.emp_id_project },
      JWT_SECRET_KEY,
      { expiresIn: "1h" }
    );

    // Include relevant employee details in the response
    res.json({
      token,
      employeeProfile: {
        employee_id: user.employee_id,
        employee_name: user.employee_name,
        emp_id_project: user.emp_id_project,
        work_detail: user.work_detail,
      },
    });
  } catch (error) {
    console.error("Login failed:", error); // Log the error for debugging
    res.status(500).json({ error: "Login failed" });
  }
});

const storageone = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads");
  },

  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const uploadone = multer({ storage: storageone });

// Check leave balance and apply leave if balance is sufficient
app.post("/apply-leave", uploadone.single("medical_Doc"), async (req, res) => {
  const {
    type_of_leave,
    emp_id,
    emp_name,
    reason,
    numberOfDays,
    startDate,
    endDate,
  } = req.body;
  const medicalDoc = req.file ? req.file.filename : null;

  // Ensure numberOfDays is a valid number
  const leaveDays = parseFloat(numberOfDays);
  if (isNaN(leaveDays) || leaveDays <= 0) {
    return res.status(400).json({ error: "Invalid number of leave days" });
  }

  // Determine the correct column for the leave type (earned, sick, flexi, casual)
  let leaveColumn;
  switch (type_of_leave) {
    case "earned":
      leaveColumn = "earned";
      break;
    case "sick":
      leaveColumn = "sick";
      break;
    case "flexi":
      leaveColumn = "flexi";
      break;
    case "casual":
      leaveColumn = "casual";
      break;
    default:
      return res.status(400).json({ error: "Invalid leave category" });
  }

  try {
    // Query to check for overlapping leave dates for the same employee
    const overlapQuery = `
      SELECT * 
      FROM leave_applied 
      WHERE emp_id = ? 
        AND (
          (startDate <= ? AND endDate >= ?) -- Overlaps with the start date
          OR
          (startDate <= ? AND endDate >= ?) -- Overlaps with the end date
          OR
          (startDate >= ? AND endDate <= ?) -- Falls within the requested date range
        )
    `;
    const [overlapResults] = await (
      await connection
    ).execute(overlapQuery, [
      emp_id,
      startDate,
      startDate,
      endDate,
      endDate,
      startDate,
      endDate,
    ]);

    if (overlapResults.length > 0) {
      return res.status(400).json({
        error:
          "Leave already applied for the selected date range. Please choose a different date range.",
      });
    }

    // Query to check leave balance in the specific category
    const leaveBalanceQuery = `
      SELECT ${leaveColumn} AS available_balance 
      FROM leave_balance 
      WHERE leave_balance_emp_id = ?
    `;

    const [balanceResults] = await (
      await connection
    ).execute(leaveBalanceQuery, [emp_id]);

    if (balanceResults.length === 0) {
      return res
        .status(400)
        .json({ error: "Leave balance not found for this employee" });
    }

    const availableBalance = balanceResults[0].available_balance;

    // Validate if the available balance is enough for the leave
    if (availableBalance < leaveDays) {
      return res.status(400).json({
        error: `Insufficient leave balance. You have ${availableBalance} days available in ${type_of_leave}.`,
      });
    }

    // Proceed to apply for leave
    const status = 0; // Default status (pending approval)
    const applyLeaveQuery = `
      INSERT INTO leave_applied (status, type_of_leave, emp_id, emp_name, reason, numberOfDays, medical_Doc, startDate, endDate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [applyResults] = await (
      await connection
    ).execute(applyLeaveQuery, [
      status,
      type_of_leave,
      emp_id,
      emp_name,
      reason,
      leaveDays,
      medicalDoc,
      startDate,
      endDate,
    ]);

    res.json({
      message: "Leave applied successfully",
      leaveAppliedId: applyResults.insertId,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Failed to apply for leave" });
  }
});

//get details of employee
app.get("/getDetailsOfemp/:employee_id", async (req, res) => {
  const employee_id = req.params.employee_id;
  const query = "select * from employee where employee_id= ?";

  try {
    const [result] = await (await connection).execute(query, [employee_id]);
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: "Failed" });
  }
});

//fetch all orders

app.get("/api/orders", async (req, res) => {
  const query = "SELECT * FROM orders"; 

  try {
        const [results] = await (
          await connection
        ).execute(query);
        res.send(results);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch the project" });
      }
});


//show all comapnies
app.get("/api/companies", async (req, res) => {
  const query = "SELECT * FROM company_list"; 

  try {
        const [results] = await (
          await connection
        ).execute(query);
        res.send(results);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch the companies" });
      }
});

//update the adta
// Assuming you're using Express and have set up MySQL or any other ORM like Sequelize

app.put('/api/companies/:id', async (req, res) => {
  const { id } = req.params;
  const { company_name, owners_count, total_member,  establishment_date } = req.body;

  try {
      // Use a raw SQL query or Sequelize to update the company data in the database
      const [results] = await (await connection).query(
        `UPDATE company_list SET company_name = ?, owners_count = ?, total_member = ?, establishment_date = ? WHERE company_id = ?`,
        [company_name, owners_count, total_member,  establishment_date,id]
      );
    

      if (results.affectedRows > 0) {
          res.json({ success: true, message: 'Company updated successfully' });
      } else {
          res.status(404).json({ success: false, message: 'Company not found' });
      }
  } catch (error) {
      console.error('Error updating company:', error);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
      console.log(company_name, owners_count, total_member,  establishment_date);
      
  }
});



//==========delete the company (admin) ================
app.delete('/api/companies/:companyId', async (req, res) => {
  const companyId = req.params.companyId;

  try {
    // Disable foreign key checks
    await (await connection).execute('SET FOREIGN_KEY_CHECKS = 0');

    // Delete related projects
    await (await connection).execute('DELETE FROM project WHERE company_id_project = ?', [companyId]);

    // Then delete the company from company_list
    const [results] = await (await connection).execute('DELETE FROM company_list WHERE company_id = ?', [companyId]);

    // Re-enable foreign key checks
    await (await connection).execute('SET FOREIGN_KEY_CHECKS = 1');

    res.send(results);
  } catch (error) {
    // Ensure foreign key checks are re-enabled even if there's an error
    await (await connection).execute('SET FOREIGN_KEY_CHECKS = 1');
    res.status(500).json({ error: "Failed to delete" });
    console.log(error);
  }
});


//admin login
app.post("/api/loginadmin", async (req, res) => {
  const { username, password } = req.body;
  const loginquery = "SELECT * FROM admin WHERE username = ?";

  try {
    const [results] = await (await connection).execute(loginquery, [username]);
    const user = results[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid user" });
    }

    const isPassValid = await bcrypt.compare(password, user.password);
    if (!isPassValid) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { username: user.username, id: user.company_id },
      JWT_SECRET_KEY,
      { expiresIn: "1h" }
    );

    // Only send the JWT token in the response
    res.json({ token });
  } catch (error) {
    console.log(error);
    
  }
});



app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    // Hash the password using bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert the username and hashed password into MySQL
    const query = 'INSERT INTO admin (username, password) VALUES (?, ?)';
    const [finalResult] = await (await connection).execute(query, [username, hashedPassword]);

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Error inserting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


app.post('/getTimesheet/:employee_id/', async (req, res) => {
  const { signin, signout, work_detail } = req.body;
  const { employee_id } = req.params;

  // Check if the employee_id exists in the employee table
  const checkEmployeeQuery = `SELECT * FROM employee WHERE employee_id = ?`;
  const checkDuplicateQuery = `
    SELECT * FROM timesheet 
    WHERE timesheet_emp_id = ? AND DATE(signin) = CURDATE()
  `;
  const insertTimesheetQuery = `
    INSERT INTO timesheet (signin, signout, work_detail, timesheet_emp_id) VALUES (?, ?, ?, ?)
  `;

  try {
    const [employeeResult] = await (await connection).execute(checkEmployeeQuery, [employee_id]);

    if (employeeResult.length === 0) {
      return res.status(400).json({ error: "Employee ID does not exist." });
    }

    // Check for existing entry for the current date
    const [duplicateResult] = await (await connection).execute(checkDuplicateQuery, [employee_id]);
    if (duplicateResult.length > 0) {
      return res.status(400).json({ error: "Timesheet entry already exists for today." });
    }

    // Get the current date in YYYY-MM-DD format
    const currentDate = new Date().toISOString().split('T')[0];
    const signinDateTime = signin ? `${currentDate} ${signin}` : null;
    const signoutDateTime = signout ? `${currentDate} ${signout}` : null;

    // Insert into timesheet table if no duplicate entry exists
    const [result] = await (await connection).execute(insertTimesheetQuery, [signinDateTime, signoutDateTime, work_detail, employee_id]);
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database error" });
  }
});


const port = process.env.PORT || 9000;
 app.listen(port, () => {
   console.log(`Server listening on port ${port}`);
 });