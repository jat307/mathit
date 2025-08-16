
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const OpenAI = require('openai');
const cors = require('cors')({ origin: true });
// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: functions.config().openai.key // Set this with Firebase CLI
});

// ============================================
// AI CHALLENGE GENERATOR FOR EDUCATORS
// ============================================
exports.generateChallenge = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // Get parameters from request
      const { 
        topic, 
        realWorldContext, 
        difficulty, 
        ageGroup, 
        educatorId 
      } = req.body;

      // Create the prompt for OpenAI
      const systemPrompt = `You are an expert math educator creating engaging, real-world math challenges for students aged ${ageGroup}. 
      Create challenges that connect abstract math to practical life situations.
      Always include step-by-step solutions and helpful hints.
      Make it fun and relevant to young people's lives.`;

      const userPrompt = `Create a math challenge with the following requirements:
      Topic: ${topic}
      Real-world context: ${realWorldContext}
      Difficulty: ${difficulty}
      Age group: ${ageGroup}
      
      Provide the response in this exact JSON format:
      {
        "title": "Catchy title that includes 'Math'",
        "description": "Brief description of the challenge",
        "problem": "The main problem statement with real-world context",
        "steps": [
          {
            "stepNumber": 1,
            "instruction": "Clear instruction for this step",
            "hint": "Helpful hint for this step",
            "answer": "Expected answer or approach"
          }
        ],
        "concepts": ["concept1", "concept2"],
        "estimatedTime": "time in minutes",
        "points": "point value based on difficulty",
        "realWorldConnection": "Why this matters in real life"
      }`;

      // Call OpenAI API
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      });

      // Parse the response
      const challengeData = JSON.parse(completion.choices[0].message.content);

      // Add metadata
      const challenge = {
        ...challengeData,
        topic,
        difficulty,
        ageGroup,
        createdBy: educatorId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        aiGenerated: true,
        status: 'draft',
        views: 0,
        completions: 0,
        rating: 0
      };

      // Save to Firestore
      const docRef = await db.collection('challenges').add(challenge);

      // Log usage for cost tracking
      await db.collection('ai_usage').add({
        function: 'generateChallenge',
        educatorId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        model: 'gpt-4o-mini',
        tokensUsed: completion.usage.total_tokens,
        cost: completion.usage.total_tokens * 0.000002 // Approximate cost
      });

      res.json({ 
        success: true, 
        challengeId: docRef.id,
        challenge 
      });

    } catch (error) {
      console.error('Error generating challenge:', error);
      res.status(500).json({ 
        error: 'Failed to generate challenge',
        details: error.message 
      });
    }
  });
});

// ============================================
// STUDENT PROBLEM MATCHER
// ============================================
exports.matchStudentProblem = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { studentQuery, studentId, gradeLevel } = req.body;

      const systemPrompt = `You are a helpful math tutor. A student has a real-life problem or question.
      Your job is to identify which math concepts would help solve their problem and find relevant challenges.
      Be encouraging and show how math connects to their situation.`;

      const userPrompt = `Student (grade ${gradeLevel}) asks: "${studentQuery}"
      
      Respond with this JSON format:
      {
        "interpretation": "What you understand they're asking",
        "relevantConcepts": ["concept1", "concept2"],
        "difficulty": "easy/medium/hard based on their grade",
        "searchTerms": ["term1", "term2"],
        "encouragement": "Positive message about how math can help",
        "example": "Quick example of how this math applies"
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo", // Cheaper for simple matching
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const matchData = JSON.parse(completion.choices[0].message.content);

      // Search for matching challenges in Firestore
      const challengesSnapshot = await db.collection('challenges')
        .where('concepts', 'array-contains-any', matchData.relevantConcepts)
        .where('difficulty', '==', matchData.difficulty)
        .limit(5)
        .get();

      const challenges = [];
      challengesSnapshot.forEach(doc => {
        challenges.push({ id: doc.id, ...doc.data() });
      });

      // Log the interaction
      await db.collection('student_queries').add({
        studentId,
        query: studentQuery,
        matchedConcepts: matchData.relevantConcepts,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      res.json({
        success: true,
        match: matchData,
        challenges
      });

    } catch (error) {
      console.error('Error matching problem:', error);
      res.status(500).json({ error: 'Failed to match problem' });
    }
  });
});

// ============================================
// PARENT CURRICULUM BUILDER
// ============================================
exports.buildCurriculum = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const {
        parentId,
        childAge,
        childGrade,
        learningGoals,
        timePerWeek,
        interests
      } = req.body;

      const systemPrompt = `You are an experienced homeschool curriculum designer.
      Create personalized math curricula that are engaging, practical, and aligned with Common Core standards.
      Focus on real-world applications and hands-on activities.`;

      const userPrompt = `Design a 4-week math curriculum for:
      - Child age: ${childAge}
      - Grade: ${childGrade}
      - Goals: ${learningGoals}
      - Available time: ${timePerWeek} hours per week
      - Child's interests: ${interests}
      
      Provide the response in this JSON format:
      {
        "curriculumTitle": "Engaging title",
        "overview": "Brief overview of what will be covered",
        "weeks": [
          {
            "weekNumber": 1,
            "theme": "Week theme",
            "concepts": ["concept1", "concept2"],
            "activities": [
              {
                "day": "Monday",
                "activity": "Activity description",
                "duration": "30 mins",
                "materials": ["material1", "material2"]
              }
            ],
            "realWorldProject": "End of week project",
            "assessmentIdeas": ["assessment1", "assessment2"]
          }
        ],
        "resourcesNeeded": ["resource1", "resource2"],
        "parentTips": ["tip1", "tip2"],
        "successMetrics": ["metric1", "metric2"]
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.6,
        response_format: { type: "json_object" }
      });

      const curriculum = JSON.parse(completion.choices[0].message.content);

      // Save curriculum to Firestore
      const docRef = await db.collection('curricula').add({
        ...curriculum,
        parentId,
        childAge,
        childGrade,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active'
      });

      // Create individual challenges for each activity
      for (const week of curriculum.weeks) {
        for (const activity of week.activities) {
          await db.collection('challenges').add({
            title: activity.activity,
            description: `Week ${week.weekNumber}: ${week.theme}`,
            difficulty: 'medium',
            ageGroup: `${childAge}-${childAge+1}`,
            concepts: week.concepts,
            curriculumId: docRef.id,
            parentId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            aiGenerated: true
          });
        }
      }

      res.json({
        success: true,
        curriculumId: docRef.id,
        curriculum
      });

    } catch (error) {
      console.error('Error building curriculum:', error);
      res.status(500).json({ error: 'Failed to build curriculum' });
    }
  });
});

// ============================================
// HINT GENERATOR (for stuck students)
// ============================================
exports.generateHint = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { 
        challengeId, 
        stepNumber, 
        studentWork, 
        hintsUsed 
      } = req.body;

      // Get the challenge from Firestore
      const challengeDoc = await db.collection('challenges').doc(challengeId).get();
      const challenge = challengeDoc.data();

      const systemPrompt = `You are a patient math tutor. 
      The student is stuck and needs a hint that guides without giving away the answer.
      Provide progressively more detailed hints based on how many they've already used.`;

      const userPrompt = `Challenge: ${challenge.problem}
      Current step: ${challenge.steps[stepNumber].instruction}
      Student's work so far: ${studentWork}
      Hints already used: ${hintsUsed}
      
      Provide hint level ${hintsUsed + 1} (out of 3 max):
      - Hint 1: Gentle nudge in right direction
      - Hint 2: More specific guidance
      - Hint 3: Step-by-step breakdown (but not the answer)
      
      Respond with JSON:
      {
        "hint": "The hint text",
        "encouragement": "Motivational message",
        "relatedConcept": "What math concept to review"
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.5,
        response_format: { type: "json_object" }
      });

      const hintData = JSON.parse(completion.choices[0].message.content);

      res.json({
        success: true,
        hint: hintData
      });

    } catch (error) {
      console.error('Error generating hint:', error);
      res.status(500).json({ error: 'Failed to generate hint' });
    }
  });
});

// ============================================
// BULK CONTENT GENERATOR (for initial data)
// ============================================
exports.generateBulkContent = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const topics = [
        { name: "Compound Interest", context: "Saving for a car" },
        { name: "Probability", context: "Gaming loot boxes" },
        { name: "Statistics", context: "Social media metrics" },
        { name: "Linear Equations", context: "Phone plan comparison" },
        { name: "Exponential Growth", context: "Viral TikTok videos" },
        { name: "Percentages", context: "Sales and discounts" },
        { name: "Ratios", context: "Recipe scaling" },
        { name: "Data Analysis", context: "Sports statistics" },
        { name: "Geometry", context: "Room decoration" },
        { name: "Functions", context: "Uber pricing" }
      ];

      const difficulties = ["easy", "medium", "hard"];
      const ageGroups = ["10-12", "12-14", "14-16", "16-17"];
      
      const generatedChallenges = [];

      for (const topic of topics) {
        for (const difficulty of difficulties) {
          // Generate one challenge per topic/difficulty combo
          const prompt = `Create a ${difficulty} math challenge about ${topic.name} 
                         using this real-world context: ${topic.context}`;

          // Add small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));

          console.log(`Generating: ${topic.name} - ${difficulty}`);
          
          // You can implement the actual generation here
          // For now, we'll create a template
          const challenge = {
            title: `Math Your ${topic.context}`,
            topic: topic.name,
            context: topic.context,
            difficulty: difficulty,
            ageGroup: difficulty === "easy" ? "10-12" : 
                     difficulty === "medium" ? "12-14" : "14-16",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            aiGenerated: true,
            status: 'published'
          };

          generatedChallenges.push(challenge);
        }
      }

      // Batch write to Firestore
      const batch = db.batch();
      generatedChallenges.forEach(challenge => {
        const docRef = db.collection('challenges').doc();
        batch.set(docRef, challenge);
      });
      await batch.commit();

      res.json({
        success: true,
        generated: generatedChallenges.length,
        message: `Generated ${generatedChallenges.length} challenges`
      });

    } catch (error) {
      console.error('Error generating bulk content:', error);
      res.status(500).json({ error: 'Failed to generate bulk content' });
    }
  });
});

// ============================================
// USAGE TRACKER (monitor costs)
// ============================================
exports.getUsageStats = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // Get usage for the current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const usageSnapshot = await db.collection('ai_usage')
        .where('timestamp', '>=', startOfMonth)
        .get();

      let totalTokens = 0;
      let totalCost = 0;
      let callsByFunction = {};

      usageSnapshot.forEach(doc => {
        const data = doc.data();
        totalTokens += data.tokensUsed || 0;
        totalCost += data.cost || 0;
        callsByFunction[data.function] = (callsByFunction[data.function] || 0) + 1;
      });

      res.json({
        month: now.toISOString().slice(0, 7),
        totalTokens,
        estimatedCost: `$${totalCost.toFixed(2)}`,
        callsByFunction,
        averageCostPerCall: `$${(totalCost / usageSnapshot.size).toFixed(4)}`
      });

    } catch (error) {
      console.error('Error getting usage stats:', error);
      res.status(500).json({ error: 'Failed to get usage stats' });
    }
  });
});