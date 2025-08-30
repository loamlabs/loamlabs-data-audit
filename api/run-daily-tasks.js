// A simple test function to confirm the endpoint is working.

module.exports = async (req, res) => {
  console.log("--- TEST SCRIPT STARTED ---");
  console.log("The /api/run-daily-tasks function was successfully triggered.");
  console.log("If you see this message, the file location and Vercel config are correct.");
  
  // Respond to the request to mark it as successful.
  res.status(200).json({ message: "Test function executed successfully." });
};
