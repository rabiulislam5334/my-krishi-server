// --- Imports ---
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express(); //
const port = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- MongoDB Connection ---
const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// --- Root Route ---
app.get("/", (req, res) => {
  res.send("🌾 KrishiLink Server is running successfully!");
});

// --- Main Function ---
async function run() {
  try {
    // await client.connect();
    console.log(" Connected to MongoDB successfully!");

    const db = client.db("model-bd");
    const cropsCollection = db.collection("crops");
    const usersCollection = db.collection("users");
    // const interestsCollection = db.collection("interests");

    // -----------------------------------------
    //  USER APIs
    // -----------------------------------------
    app.post("/users", async (req, res) => {
      try {
        const newUser = req.body;
        const query = { email: newUser.email };
        const existingUser = await usersCollection.findOne(query);

        if (existingUser) {
          return res
            .status(200)
            .send({ message: "User already exists", userId: existingUser._id });
        }

        // Insert new user
        const result = await usersCollection.insertOne(newUser);
        res
          .status(201)
          .send({ message: "User created", userId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to save user" });
      }
    });
    // interest added
    // Get user's interests from crops collection
    app.get("/interests", async (req, res) => {
      const userEmail = req.query.userEmail;
      if (!userEmail) {
        return res.status(400).send({ message: "Missing user email" });
      }

      const crops = await cropsCollection.find().toArray();

      // user-এর interests বের করো
      const userInterests = [];
      crops.forEach((crop) => {
        if (Array.isArray(crop.interests)) {
          crop.interests.forEach((interest) => {
            if (interest.userEmail === userEmail) {
              userInterests.push({
                cropId: crop._id,
                cropName: crop.name,
                image: crop.image,
                location: crop.location,
                pricePerUnit: crop.pricePerUnit,
                quantity: interest.quantity,
                message: interest.message,
                status: interest.status,
              });
            }
          });
        }
      });

      res.send(userInterests);
    });

    // GET /users → Optional: fetch all users (for testing/admin)
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    // -----------------------------------------
    //  CROP APIs
    // -----------------------------------------

    // Get all crops
    app.get("/crops", async (req, res) => {
      const search = req.query.search || "";
      const filter = search ? { name: { $regex: search, $options: "i" } } : {};
      const result = await cropsCollection.find(filter).toArray();
      res.send(result);
    });

    // Get latest 6 crops
    app.get("/crops/latest", async (req, res) => {
      const result = await cropsCollection
        .find()
        .sort({ _id: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // Get single crop details
    app.get("/crops/:id", async (req, res) => {
      const id = req.params.id;
      const crop = await cropsCollection.findOne({ _id: new ObjectId(id) });
      if (!crop) {
        return res.status(404).send({ message: "Crop not found" });
      }
      res.send(crop);
    });

    // Add new crop
    app.post("/crops", async (req, res) => {
      const crop = req.body;
      crop.interests = [];
      const result = await cropsCollection.insertOne(crop);
      res.send(result);
    });

    // Update crop (for owner)
    app.patch("/crops/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const result = await cropsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.send(result);
    });

    // Delete crop (for owner)
    app.delete("/crops/:id", async (req, res) => {
      const id = req.params.id;
      const result = await cropsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // -----------------------------------------
    // 💬 INTEREST APIs
    // -----------------------------------------

    // Send interest
    app.post("/crops/:id/interests", async (req, res) => {
      const cropId = req.params.id;
      const interest = req.body;

      const crop = await cropsCollection.findOne({
        _id: new ObjectId(cropId),
      });
      if (!crop) return res.status(404).send({ message: "Crop not found" });

      // prevent duplicate interest
      const already = crop.interests?.some(
        (i) => i.userEmail === interest.userEmail
      );
      if (already)
        return res
          .status(400)
          .send({ message: "You have already sent interest for this crop" });

      const interestId = new ObjectId();
      const newInterest = { _id: interestId, ...interest };
      const result = await cropsCollection.updateOne(
        { _id: new ObjectId(cropId) },
        { $push: { interests: newInterest } }
      );
      res.send({ insertedId: interestId, result });
    });

    // Owner manage interest (Accept/Reject)
    app.put("/crops/:cropId/interests/:interestId", async (req, res) => {
      const { cropId, interestId } = req.params;
      const { status } = req.body;

      const crop = await cropsCollection.findOne({
        _id: new ObjectId(cropId),
      });
      if (!crop) return res.status(404).send({ message: "Crop not found" });

      const interest = crop.interests.find(
        (i) => i._id.toString() === interestId
      );
      if (!interest)
        return res.status(404).send({ message: "Interest not found" });

      if (interest.status !== "pending")
        return res
          .status(400)
          .send({ message: "Interest already accepted or rejected" });

      // update status
      await cropsCollection.updateOne(
        {
          _id: new ObjectId(cropId),
          "interests._id": new ObjectId(interestId),
        },
        { $set: { "interests.$.status": status } }
      );

      // reduce quantity if accepted
      if (status === "accepted") {
        const newQuantity = crop.quantity - interest.quantity;
        await cropsCollection.updateOne(
          { _id: new ObjectId(cropId) },
          { $set: { quantity: Math.max(newQuantity, 0) } }
        );
      }

      res.send({ success: true });
    });

    // Get all interests of a user (My Interests)
    app.get("/my-interests/:email", async (req, res) => {
      const email = req.params.email;
      const crops = await cropsCollection.find().toArray();

      const myInterests = [];
      crops.forEach((crop) => {
        crop.interests?.forEach((interest) => {
          if (interest.userEmail === email) {
            myInterests.push({
              cropId: crop._id,
              cropName: crop.name,
              ownerName: crop.owner.ownerName,
              ownerEmail: crop.owner.ownerEmail,
              quantity: interest.quantity,
              message: interest.message,
              status: interest.status,
            });
          }
        });
      });
      res.send(myInterests);
    });

    // -----------------------------------------
    // 🧾 My Posts (user’s own crops)
    // -----------------------------------------
    app.get("/my-crops/:email", async (req, res) => {
      const email = req.params.email;
      const result = await cropsCollection
        .find({ "owner.ownerEmail": email })
        .toArray();
      res.send(result);
    });

    // -----------------------------------------
    //
    // -----------------------------------------
    // await client.db("admin").command({ ping: 1 });
    console.log(" KrishiLink server connected and running properly!");
  } catch (error) {
    console.error(" Error connecting to MongoDB:", error);
  }
}

run().catch(console.dir);

// --- Listen ---
app.listen(port, () => {
  console.log(` KrishiLink server is running on port ${port}`);
});
