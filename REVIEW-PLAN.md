# Review Plan

This file summarizes the feedback I received from peer reviewers and the course staff, and documents my response plan for each item.

---

## Peer Review — Reviewer 1 

**Feedback 1:** "A simple fix could be to check the quality of the recognized text before passing it along. The app could just return a low confidence warning early instead of wasting a call to the more expensive model."

**Response:** This is a good idea to conserve model calls. To do this, I need to have the first model return a confidence level, and if it is below a certain threshold, show a warning to the user before proceeding to the second, more expensive model. 

---

**Feedback 2:** "I would prioritize the mobile UI since a note scanning app makes the most sense to use on a phone."

**Response:** This is something that was in my proposal and I do plan on making the application work for mobile devices. I need to ensure that the formatting is correct, i.e. nothing gets cut off the screen. I should also give users the option to take a photo directly in the application and upload it, so they don't have to open the camera app + the application, as this will probably be a common use case for users using this application on their phone.  

---

## Peer Review — Reviewer 2 

**Feedback 1:** "I think one thing that could be done is to add a cache for study tool generation, especially like generating flashcards or practice quiz questions since that would be something done often when studying. Having a cache would decrease API calls, and thus costs and latency as well."

**Response:** To do this, all three study tool endpoints (flashcards, practice questions, summarry of notes for a course) need to return cached results by default on subsequent calls. Results need to be stored in the database and re-served without hitting the AI pipeline. I would also like to give users the option to re-generate a new study tool if that is the goal, but they would need to explicitly request it. Default behavior would be to return the cached result. 

---

**Feedback 2:** "I think the responsive UI is the most important. As this is document uploading, I am sure many students would like to have this on their phones as that makes everything more convenient."

**Response:** Same as Reviewer 1, Feedback 2. 

---

## Staff Feedback

**Feedback 1:** "Publicly sharable notes -> would be super cool to have not just a publicly accessable note but one that multiple people could
collaborate on!"

**Response:** I would like to implement this, and give users the option to share the note with different permissions, i.e. view-only or editing allowed. I would also need to add a "Shared with me" section in the Library so users can clearly visualize the notes that they created vs. ones that were shared with them. 

---

**Feedback 2:** "Caching tool generations to reduce API calls and cost"

**Response:** Same as Reviewer 2, Feedback 1.

---

**Feedback 3:** "Mobile reponsive UI - it sounds like this is planned, and this would be very helpful to many users of your app! It is much easier to take pictures on your phone rather than taking a picture and uploading it
to your computer."

**Response:** Same as Reviewer 1, Feedback 2. 

---

**Feedback 4:** "Add a low cofidence warning for low quality pictures."

**Response:** Same as Reviewer 1, Feedback 1. 
