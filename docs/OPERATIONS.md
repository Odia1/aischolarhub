1. ### SCOPE OF OPERATION & DOMAIN RESTRICTIONS
You are strictly an academic and educational learning mentor for the college program.

BOUNDARY RULES:
1. SCOPE: You may ONLY assist with academic subjects, university coursework, STEM, humanities, coding, research methodologies, literature reviews, and professional skill development.
2. OUT-OF-SCOPE REQUESTS: If a user asks for non-academic help—such as cooking recipes, gaming advice, entertainment recommendations, personal shopping, or casual lifestyle tips—you MUST politely decline.
3. REFUSAL TEMPLATE:
   "I am configured strictly as an academic learning portal for our studies. I cannot assist with personal or non-academic requests like recipes. How can I help you with our coursework, coding, or research today?"
Why this works: When a student asks, "Give me a recipe for our Sunday evening dinner," the AI will evaluate the request against rule #2 and output the polite refusal template instead of generating the recipe.

2. Hard Content & Category Filters (Admin Level)
If you want an automated technical barrier before the prompt even reaches the AI model, The filter evaluates the student's prompt before sending it to Gemini; if the intent classifies as "Lifestyle/Entertainment," it returns an instant canned response: "Non-academic query blocked."

3. UI Framing & Interface Nudges
If students open a blank text box, their instinct is to treat it like a search engine. You can change their mindset by altering how the web interface looks:
•	Remove Blank Prompt Bars: Replace the default empty chat window with Preset Action Chips right above the chat input:
o	🧪 “Debug my Python logic”
o	📖 “Summarize this PDF research paper”
o	📝 “Review my essay structure (don't rewrite it)”
•	Static Portal Banner: Place a top header on the portal interface:SEEDS Academic Platform: This system is funded to support university coursework and research. Prompts are monitored for token allocation and strictly limited to educational usage.
4. Anonymized Usage Analytics (Auditing without Violating Privacy)
Because students log in with their college SSO or domain emails (@student.college.edu), our portal's admin panel maintains usage logs.
•	You do not need to read their full private chats, but the admin dashboard shows frequently used keywords and topic tags.
•	If a student consistently attempts to use their monthly token quota for non-academic tasks, their daily token budget (~30–50 prompts/day) will quickly run out, naturally constraining misuse while reserving API resources for students who are using the platform for genuine study.
Sources
1.	Functions - Open WebUI
________________________________________
User prompt: If the students and scholars upload books papers, and such materials, will they not consume a lot of AI resources?
Response: Yes, if done naively, uploading entire textbooks and research PDFs can quickly drain API tokens.
If every time a student asks a simple question like "What is the formula on page 42?", our portal re-sends a 500-page PDF back to the Gemini API, you will re-process millions of tokens per query.
However, open-source platforms like Open WebUI and LibreChat use Retrieval-Augmented Generation (RAG) and Context Caching to make uploading large files extremely lightweight and low-cost.
1. How RAG Keeps Costs Very Low
When a student uploads a 300-page book or paper into the portal, the system does NOT send the entire book to the LLM every time they ask a question.
[ Upload 300-Page PDF ] ──> Processed ONCE into small chunks ──> Stored in local Vector Database
                                                                           │
                                                                           ▼
[ Student asks a question ] ──> Vector Search finds ONLY relevant 2-3 paragraphs ──> Sent to Gemini


1.	One-Time Embedding: When a document is uploaded, an embedding model converts the text into mathematical vectors. Generating embeddings for a 300-page textbook costs less than $0.01.
2.	Selective Chunking: When the student asks a question, the vector database searches the book locally and extracts only the specific 2 or 3 paragraphs needed to answer.
3.	Minimal API Tokens: Instead of sending 200,000 tokens (the whole book), the portal only sends ~1,000 tokens (the prompt + extracted paragraphs) to Gemini Flash.
2. Technical Controls to Prevent Resource Draining
To guarantee that uploaded materials do not overload our storage or API credits, configure these controls in our admin panel:
A. Document Upload Limits (File Size Caps)
•	Undergrads: Cap file uploads to 10 MB per file (plenty for lecture slides, syllabi, and individual academic papers).
•	PhD / Post-Docs: Allow larger limits (e.g., 50 MB), but limit total uploaded files per account to preserve server disk space.
B. Use Gemini Context Caching for Large Shared Textbooks
If an entire class is studying the same 500-page core textbook all semester:
•	Upload the textbook to Open WebUI's Workspace Knowledge Base once.
•	Enable Gemini Context Caching. Google caches the tokenized textbook in its memory, reducing input token costs for that book by up to 75–80% across all student queries.
C. Restrict Vision/PDF OCR Scans
Text-based PDFs use very few tokens. Scanned PDFs (where every page is a high-resolution image) consume significantly more tokens to process visual text.
•	Configure our portal's frontend to run local PDF text extraction (e.g., using PyPDF or pdfplumber) before sending text to the API. This strips out heavy background images and sends raw text, saving API bandwidth.
3. Cost Breakdown: Individual Papers vs. Full Textbooks
Using high-efficiency models like Gemini 1.5/2.0 Flash:

Material Type	Typical Token Size	One-Time Embedding Cost	Average Query Cost (with RAG)
15-Page Research Paper	~10,000 tokens	~$0.0001	< $0.0001 per question
50-Page Journal Article	~35,000 tokens	~$0.0003	< $0.0001 per question
500-Page Textbook	~300,000 tokens	~$0.0030	~$0.0002 per question
Summary Impact
[Verify: Because RAG breaks documents into tiny fragments, 1,000 students regularly searching through research PDFs and textbooks will typically consume less than $10 to $20 per month in total API costs]
________________________________________
Many students may have the same books and same papers they are studying. How is that handled?
Response: When dozens or hundreds of students study from the same standard textbooks, research papers, or syllabus materials, processing them individually for every student would waste disk space and compute.
Our tool handles this scenario through Centralized Shared Knowledge Bases, File Hash Deduplication, and Shared Context Caching.
1. Centralized "Shared Knowledge Bases" (Admin Provisioning)
Instead of expecting 100 undergraduates to individually upload a 500-page organic chemistry or computer architecture textbook, administrators or course instructors upload the document once to a shared workspace.
                 [ Admin / Instructor ]
                           │
             Uploads Textbook ONCE to Server
                           │
                           ▼
          [ Shared Knowledge Base Collection ]
            (e.g., "CS-101: Data Structures")
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
[ Student 1 Chat ]  [ Student 2 Chat ]  [ Student 3 Chat ]
  (Queries Index)     (Queries Index)     (Queries Index)


•	Zero Student Effort: Students don't have to upload anything. When they select their course persona or folder in the UI, the shared textbook is already linked as a reference.
•	Shared Storage & Vectorization: The server parses and embeds the book only once. All students query the same underlying database index, preventing redundant disk usage or duplicate processing.
2. File Hash Deduplication (When Students Do Upload)
If multiple students do upload the exact same PDF independently (e.g., a paper assigned for homework), the system checks the file's SHA-256 digital fingerprint before processing it:
1.	Instant Recognition: If Student B uploads a PDF that Student A already uploaded 2 hours prior, the system recognizes the matching file hash.
2.	Re-use Existing Embeddings: Rather than re-parsing and re-indexing the PDF, the server instantly attaches the existing embedded vector chunks to Student B’s account.
3.	Cost Saved: API vectorization costs drop to $0 for all duplicate uploads after the first one.
3. Gemini Context Caching (Massive Token Discounts)
When thousands of queries hit the exact same core textbook or syllabus throughout a semester, Google Cloud's Gemini Context Caching kicks in at the API layer:
•	How It Works: Google keeps the tokenized representation of the shared textbook active in GPU memory.
•	Cost Reduction: Instead of paying standard rates every time a student references the book, cached input tokens receive a ~75% to 80% price reduction, and latency drops significantly.
4. Best Practices for Course Managers
To keep our portal organized and cost-efficient:
•	Create Class Folders: Organize shared materials into structured collections (e.g., Course Materials → Physics 201).
•	Pre-Load Reading Lists: At the start of each semester, have teaching assistants or faculty drop all required syllabus PDFs and papers into the portal's shared workspace.
•	Restrict Personal File Storage: Allow students to upload temporary files for personal note-taking, but set an automatic cleanup policy that clears non-book chat attachments after 30 days.
________________________________________

Once you finish the initial server setup, the open-source platform handles file deduplication, token caching, and background database processing automatically.
our second point hits on an essential architectural requirement: Role-Based Access Control (RBAC). Open-source platforms like Open WebUI or LibreChat natively support multi-tiered roles so instructors can publish materials for students, while advanced scholars manage their own private research libraries.

Multi-Tiered Library Architecture (Instructors vs. Students)
Our platform provides Workspace Folders and Access Groups. This lets you structure materials across three distinct tiers:
┌─────────────────────────────────────────────────────────────┐
│ 1. GLOBAL / COURSE LIBRARY (Read-Only for Students)         │
│    • Uploaded by: Instructors / Program Admins              │
│    • Contents: Syllabi, Core Textbooks, Lecture Slides       │
│    • Access: Visible & queryable by ALL enrolled students   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│ 2. ADVANCED / LAB LIBRARIES (Group-Restricted)              │
│    • Uploaded by: PhDs, Post-Docs, Lab Leaders              │
│    • Contents: Specialized arXiv papers, Domain Datasets     │
│    • Access: Restricted to specific research group members  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│ 3. PERSONAL STUDENT WORKSPACE (Private)                     │
│    • Uploaded by: Individual Students                       │
│    • Contents: Personal assignment drafts, private notes     │
│    • Access: 100% Private (Isolated to that student)        │
└─────────────────────────────────────────────────────────────┘


3. Different Roles in the System:
To set this up, you assign users to specific roles inside the portal's Admin Panel:
A. The Instructor / Faculty Experience
•	Capabilities: Instructors are assigned Workspace Manager or Editor roles.
•	Workflow: An instructor logs in, creates a shared Knowledge Folder (e.g., "Data Structures 101"), and drops 5 PDFs into it.
•	Student Impact: The instructor toggles the folder visibility to "Public/Course Group". Instantly, every student enrolled in that course can ask the AI questions grounded in those 5 PDFs—without students ever having to upload the files themselves.
B. The PhD / Post-Doc Experience
•	Capabilities: Advanced researchers receive Researcher roles. They can build custom Personal Knowledge Bases or shared Research Group Collections.
•	Workflow: A post-doc working on a thesis uploads a collection of 30 specialized research papers.
•	Privacy: This library remains completely invisible to undergraduate students. The post-doc can choose to keep it 100% private or share editing access with 2 other scholars in their specific lab.
C. The Undergraduate Experience
•	Capabilities: Standard Student accounts have Read-Only access to course-wide libraries.
•	Workflow: When an undergraduate opens the chat, the course textbook and syllabus are already attached as reference sources. They can upload temporary files (like their own essay outline) for review, but they cannot delete or alter official course materials.

To achieve this structure, you only need to configure two settings during server installation:
1.	Create User Groups: Define Undergraduates, Instructors, and Researchers in the user management tab.
2.	Assign Folder Permissions: Set our course folders to "Read-Only for Undergraduates" and give Instructors "Publish/Upload" rights.
Once those permissions are configured, instructors manage their own course materials, researchers build their own libraries, and the server automates deduplication, vector searches, and token optimization in the background.

________________________________________

Method 1: CSV Bulk-Import via Admin Dashboard
If you are using Open WebUI, the Admin Panel allows direct CSV user provisioning:
Method 1. Format our Spreadsheet (.csv)
Structure our CSV file with the following standard columns:

email,name,temp_password,role,token_quota
odia@seedsnet.org,Odia User,foobar123,undergrad,200000
ai@seedsnet.org,AI Scholar,foobar234,phd,1000000

Method 2: SSO / Domain Auto-Mapping (Zero Manual Invites)
If our students are logging in using their official institutional emails via Google Single Sign-On (SSO) or OAuth, you don't even need to pre-create accounts line-by-line.
Instead, you upload the CSV or map our rules at the Group level:
1.	Pre-define 3 Groups in the UI: Undergraduates, Researchers, Instructors.
2.	Assign Attributes to Groups:
o	Undergraduates: 200,000 monthly tokens | 10MB max upload limit | Socratic Tutor persona default.
o	Researchers: 1,000,000 monthly tokens | 50MB max upload limit | Research Synthesizer persona default.
3.	Domain / Group Mapping Rules: Set up auto-assignment rules based on email patterns or institutional metadata from our spreadsheet (e.g., any email ending in @researcher.university.edu or containing specific LDAP attributes automatically drops into the Researchers group upon first login).

•	Storage Allocation: Uploads from students in the Undergraduates group are automatically stored in temporary, auto-cleaning directories, while files uploaded by users in the Instructors group are stored in the permanent Shared Course Library.
