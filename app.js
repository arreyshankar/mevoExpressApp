var createError = require('http-errors');
var express = require('express');
const fs = require("fs")
const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");
const {spawn, spawnSync, exec} = require('child_process');
var { MongoClient } = require('mongodb')
const PythonShell = require('python-shell').PythonShell;
var { mongo } = require('mongoose')
const { readFile } = require('fs/promises');
const { appendFile } = require('fs/promises');
var bodyParser = require('body-parser')
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const PORT = 3000
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
const { jsonp } = require('express/lib/response');
const DB_URL = process.env.MONGO_DB_URI
const DB_CLIENT = new MongoClient(DB_URL)
const DATABASE = DB_CLIENT.db(process.env.DATABASE_NAME)
const accountKey = process.env.BLOB_STORAGE_ACCOUNT_KEY
const usersCollection = DATABASE.collection('users')
const doctorsCollection = DATABASE.collection('doctors')
const roomsCollection = DATABASE.collection('rooms')
const medicinesCollection = DATABASE.collection('medicines')
const patientsCollection = DATABASE.collection('patients')
const notificationsCollection = DATABASE.collection('notifications')

var app = express();

const account = "mevodrive";
const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
const blobServiceClient = new BlobServiceClient(`https://${account}.blob.core.windows.net`, sharedKeyCredential);
const containerName = "patientimagess";

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);


function runPython() {
  return spawn(__dirname + '/Python312/python.exe',[__dirname + '/script.py']);
}

function base64ToImage(base64String, filePath) {
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
}

async function uploadFileToBlobStorage(containerName, blobName, filePath) {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  const data = fs.readFileSync(filePath);
  const uploadBlobResponse = await blockBlobClient.upload(data, data.length);

  console.log(`Uploaded blob "${blobName}" successfully`, uploadBlobResponse.requestId);
}

app.get('/saveblob', async(req,res)=>{
  
  const containerName = "patientimagess";
  const directoryPath = __dirname + "/PatientImages"; 
  async function uploadImagesFromDirectory(containerName, directoryPath) {
    const containerClient = blobServiceClient.getContainerClient(containerName);

    const files = fs.readdirSync(directoryPath);
    
    for (const file of files) {
        const filePath = path.join(directoryPath, file);
        const blobName = file;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.uploadFile(filePath);

        console.log(`Uploaded ${filePath} to ${containerName}/${blobName}`);
    }

    console.log("All images uploaded successfully.");
}

uploadImagesFromDirectory(containerName, directoryPath)
    .catch(error => {
        console.error("Error uploading images:", error);
    });

})

app.post('/ScanPatient', async(req,res)=>{
  let imageName = 'temp.jpg'
  let base64Image = req.body.imageData.split(';base64,').pop();
  let image_path = __dirname + '/tempImages/' + imageName
  fs.writeFile(image_path, base64Image, {encoding: 'base64'}, function(err) {
    console.log('File created');
    var output = ""
    const FaceRecognizer = runPython()

    FaceRecognizer.stdout.on('data',(data)=>{
      result = new Boolean(true)
      console.log('data:: ',data.toString())
      output = data.toString('utf-8');
    })
  
    FaceRecognizer.stderr.on('data',(data)=>{
      console.log('err:: ',data.toString())
      result = new Boolean(false)
    })
  
    FaceRecognizer.on('error',(error)=>{
      console.log('error:: ',error.message)
    })
  
    FaceRecognizer.on('close',(code)=>{
      console.log('\nchild process exited with code ',code)
    })
    const patient = {
      PatientName : "req.body.PatientName",
      PatientAge : "req.body.PatientAge",
      PatientContact : "req.body.PatientContact",
      PatientAddress : "req.body.PatientAddress",
      PatientGender : "req.body.PatientGender",
      PatientImage : output
    }

    console.log(output)
    res.status(200).send(JSON.stringify(patient))
  });
})

app.get('/pyScript', async(req,res) => {
  var result = new Boolean(false)
  const pythonScript = runPython(req.body.filename)
  var dataToSend;
  pythonScript.stdout.on('data',(data)=>{
    result = new Boolean(true)
    console.log('data:: ',data.toString())
    dataToSend = data.toString('utf-8');
  })

  pythonScript.stderr.on('data',(data)=>{
    console.log('err:: ',data.toString())
    result = new Boolean(false)
  })

  pythonScript.on('error',(error)=>{
    console.log('error:: ',error.message)
  })

  pythonScript.on('close',(code)=>{
    console.log('\nchild process exited with code ',code)
  })

  if(result){
    const data = require('./output.json')
    res.send(data)
  } else{
    res.send(JSON.stringify({ status: 500, message: 'Server error' }))
  }
})

app.post('/signup', async(req,res) => {
  const user = {
    name: req.body.name,
    email: req.body.email,
    password: req.body.password
  }

  const result = await usersCollection.insertOne(user)
  console.log(`A document was inserted with the _id: ${result.insertedId}`);
  if(result.insertedId != null){
    var obj = { message: "Registered Successfully" }
    res.send(JSON.stringify(obj))
  }
})

app.post('/signin', async(req,res) => {
  const user = {
    email: req.body.email,
    password: req.body.password
  }

  const result = await usersCollection.findOne(user)
  if(result != null){
    var obj = { message: "Login Successfully" }
    res.status(200).send(JSON.stringify(result))
  } else if(result == null){
    var obj = { message: "Invalid Credentials" }
    res.status(205).send(JSON.stringify(obj))
  }
})

app.post('/AddRoom', async(req,res) => {
  const room = {
    roomNo: req.body.roomNo,
    roomName: req.body.roomName,
    isAvailable: req.body.isAvailable
  }

  const result = await roomsCollection.insertOne(room)
  console.log(`A Room document was inserted with the _id: ${result.insertedId}`);
  if(result != null){
    var obj = { message: "Room Added Successfully" }
    res.status(200).send(JSON.stringify(obj))
  } else if(result == null){
    var obj = { message: "Error while Adding" }
    res.status(201).send(JSON.stringify(obj))
  }
})

app.post('/EditRoom', async(req,res) => {
  const Room = {
    roomNo: req.body.roomNo,
    isAvailable: req.body.isAvailable
  }

  const result = await roomsCollection.updateOne({ roomNo : req.body.roomNo}, { $set : { isAvailable : req.body.isAvailable } })
  console.log(`A Room document was Updated with the _id: ${result.insertedId}`);
  if(result != null){
    var obj = { message: "Room Updated Successfully" }
    res.status(200).send(JSON.stringify(obj))
  } else if(result == null){
    var obj = { message: "Error while Updating Room" }
    res.status(201).send(JSON.stringify(obj))
  }
})

app.get('/GetRooms', async(req,res) => {
  const result = await roomsCollection.find().toArray()
  if(result != null){
    res.status(200).send(JSON.stringify(result))
  } else if(result == null){
    res.status(201).send(JSON.stringify({ message: "Error Getting rooms" }))
  }
})

app.get('/GetDoctors', async(req,res) => {
  const result = await doctorsCollection.find().toArray()
  if(result != null){
    res.status(200).send(JSON.stringify(result))
  } else if(result == null){
    res.status(201).send(JSON.stringify({ message: "Error Getting rooms" }))
  }
})

app.post('/AddPatient', async(req,res) => {
  const patient = {
    PatientName : req.body.PatientName,
    PatientAge : req.body.PatientAge,
    PatientContact : req.body.PatientContact,
    PatientAddress : req.body.PatientAddress,
    PatientGender : req.body.PatientGender,
    PatientImage : req.body.PatientImage
  }

  const result = await patientsCollection.insertOne(patient)
  console.log(`A Patient document was inserted with the _id: ${result.insertedId}`);
  try{
    const base64String = req.body.PatientImage.split(';base64,').pop()
    blobName = req.body.PatientName + '_'+ result.insertedId + '.jpg'
    const file_path = 'temp_image.jpg'
    base64ToImage(base64String,file_path)
    await uploadFileToBlobStorage(containerName, blobName, file_path)
    fs.unlinkSync(file_path);
    console.log('Image saved in blob')
  } catch(error){
      console.error("Error uploading image to Azure Blob Storage:", error);
      res.status(500).json({ error: " Internal server error" });
  }

  /*
  let base64Image = req.body.PatientImage.split(';base64,').pop();
  let image_path = __dirname + '/PatientImages/' + patient.PatientName + '_' + result.insertedId + '.png'
  fs.writeFile(image_path, base64Image, {encoding: 'base64'}, function(err) {
    console.log('File created');
  });
  */
  
  if(result != null){
    var obj = { message: "Patient Added Successfully" }
    res.status(200).send(JSON.stringify(obj))
  } else if(result == null){
    var obj = { message: "Error while Adding" }
    res.status(201).send(JSON.stringify(obj))
  }
})

app.post('/EditPatient', async(req,res) => {
  const patient = {
    
  }
})

app.get('/GetNotifications', async(req,res) => {
  const result = await notificationsCollection.find().toArray()
  if(result != null){
    res.status(200).send(JSON.stringify(result))
  } else if(result == null){
    res.status(201).send(JSON.stringify({ message: "Error Getting notifications" }))
  }
})

app.get('/GetMedicines', async(req,res) => {
  const result = await medicinesCollection.find().toArray()
  if(result != null){
    res.status(200).send(JSON.stringify(result))
  } else if(result == null){
    res.status(201).send(JSON.stringify({ message: "Error Getting medicines" }))
  }
})

app.post('/AddMedicine', async(req,res) => {
  const medicine = {
    MedicineName : req.body.MedicineName,
    MedicineID : req.body.MedicineID,
    MedicineQty : req.body.MedicineQty
  }

  const result = await medicinesCollection.insertOne(medicine)
  console.log(`A Medicine document was inserted with the _id: ${result.insertedId}`);
  if(result != null){
    var obj = { message: "Medicine Added Successfully" }
    res.status(200).send(JSON.stringify(obj))
  } else if(result == null){
    var obj = { message: "Error while Adding" }
    res.status(201).send(JSON.stringify(obj))
  }
})

app.get('/GetPatients', async(req,res) => {
  const result = await patientsCollection.find().toArray()
  if(result != null){
    res.status(200).send(JSON.stringify(result))
  } else if(result == null){
    res.status(201).send(JSON.stringify({ message: "Error Getting Patients" }))
  }
});

app.post('/DeletePatient', async(req,res) => {
  console.log(JSON.stringify(req.body))
  const result = await patientsCollection.deleteOne({ _id : new mongo.ObjectId(req.body._id) })
  if(result.deletedCount > 0){
    console.log(`A Patient document was deleted with the _id: ${req.body._id}`);
    var obj = { message: "Patient Deleted Successfully" }
    res.status(200).send(JSON.stringify(obj))
  } else {
    var obj = { message: "Error while Deleting" }
    res.status(201).send(JSON.stringify(obj))
  }
  
});

app.post('/DeleteRoom', async(req,res) => {
const result = await roomsCollection.deleteOne({ roomNo : req.body.roomNo })
if(result.deletedCount > 0){
  console.log(`A Room document was deleted with the roomNo: ${req.body.roomNo}`);
  var obj = { message: "Room Deleted Successfully" }
  res.status(200).send(JSON.stringify(obj))
} else {
  var obj = { message: "Error while Deleting" }
  res.status(201).send(JSON.stringify(obj))
}

});

app.listen(PORT, () => {
  console.log(`App listening on PORT: ${PORT}`)
})

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;