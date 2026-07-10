const mongoose = require('mongoose');
const path = require('path');
require('@babel/register')({
  presets: ['@babel/preset-env']
});

const MONGO_URI = process.env.LOCAL_MONGO_HOST || 'mongodb://localhost:27017/executive_email_assistant';

async function check() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB:', MONGO_URI);

  const Employee = mongoose.model('Employee', new mongoose.Schema({}, { strict: false }), 'employees');
  const MicrosoftUser = mongoose.model('MicrosoftUser', new mongoose.Schema({}, { strict: false }), 'microsoft_users');
  const OutlookUser = mongoose.model('OutlookUser', new mongoose.Schema({}, { strict: false }), 'outlook_users');

  const employees = await Employee.find({}).lean();
  console.log('\n--- Employees ---');
  employees.forEach(e => {
    console.log(`- ID: ${e._id}, Name: ${e.name}, Email: ${e.email}, Role: ${e.role}`);
  });

  const msUsers = await MicrosoftUser.find({}).lean();
  console.log('\n--- Microsoft Users (Teams) ---');
  msUsers.forEach(u => {
    console.log(`- ID: ${u._id}, Email: ${u.email}, Active: ${u.active}, Provider: ${u.provider}`);
  });

  const outlookUsers = await OutlookUser.find({}).lean();
  console.log('\n--- Outlook Users (Email) ---');
  outlookUsers.forEach(u => {
    console.log(`- ID: ${u._id}, Email: ${u.email}, Active: ${u.active}, Provider: ${u.provider}, loginUserEmailId: ${u.loginUserEmailId}, purpose: ${u.purpose}`);
  });

  await mongoose.disconnect();
}

check().catch(console.error);
