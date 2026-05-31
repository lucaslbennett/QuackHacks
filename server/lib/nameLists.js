// Common real-world given names and surnames for influencer onboarding.
// SSA-popular and census-common names plus widely used international names.

export const FIRST_NAMES = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Christopher", "Karen", "Charles", "Lisa", "Daniel", "Nancy",
  "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
  "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle",
  "Kenneth", "Carol", "Kevin", "Amanda", "Brian", "Melissa", "George", "Deborah",
  "Timothy", "Stephanie", "Ronald", "Rebecca", "Edward", "Sharon", "Jason", "Laura",
  "Jeffrey", "Cynthia", "Ryan", "Kathleen", "Jacob", "Amy", "Gary", "Angela",
  "Nicholas", "Shirley", "Eric", "Anna", "Jonathan", "Brenda", "Stephen", "Pamela",
  "Larry", "Emma", "Justin", "Nicole", "Scott", "Helen", "Brandon", "Samantha",
  "Benjamin", "Katherine", "Samuel", "Christine", "Raymond", "Debra", "Gregory", "Rachel",
  "Frank", "Carolyn", "Alexander", "Janet", "Patrick", "Catherine", "Jack", "Maria",
  "Dennis", "Heather", "Jerry", "Diane", "Tyler", "Ruth", "Aaron", "Julie",
  "Jose", "Olivia", "Adam", "Joyce", "Nathan", "Virginia", "Henry", "Victoria",
  "Douglas", "Kelly", "Zachary", "Lauren", "Peter", "Christina", "Kyle", "Joan",
  "Noah", "Evelyn", "Ethan", "Judith", "Jeremy", "Megan", "Walter", "Andrea",
  "Christian", "Hannah", "Keith", "Jacqueline", "Roger", "Martha", "Terry", "Gloria",
  "Austin", "Teresa", "Sean", "Ann", "Gerald", "Sara", "Carl", "Madison",
  "Dylan", "Frances", "Harold", "Kathryn", "Jordan", "Janice", "Jesse", "Jean",
  "Bobby", "Kayla", "Johnny", "Liam", "Willie", "Mason", "Craig", "Lucas",
  "Albert", "Ava", "Ella", "Jimmy", "Chloe", "Antonio", "Camila", "Diego",
  "Mohammed", "Fatima", "Ahmed", "Aisha", "Omar", "Layla", "Wei", "Mei",
  "Hiro", "Yuki", "Raj", "Priya", "Carlos", "Elena", "Marcus", "Nina",
  "Oluwaseun", "Adaeze", "Kwame", "Amara", "Ivan", "Sofia", "Marco", "Luca",
  "Pierre", "Claire", "Min", "Ji", "Soo", "Hye", "Arjun", "Ananya",
];

export const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
  "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
  "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young",
  "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
  "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker",
  "Cruz", "Edwards", "Collins", "Reyes", "Stewart", "Morris", "Morales", "Murphy",
  "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper", "Peterson", "Bailey",
  "Reed", "Kelly", "Howard", "Ramos", "Kim", "Cox", "Ward", "Richardson",
  "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett", "Gray", "Mendoza",
  "Ruiz", "Hughes", "Price", "Alvarez", "Castillo", "Sanders", "Patel", "Myers",
  "Long", "Ross", "Foster", "Jimenez", "Powell", "Jenkins", "Perry", "Russell",
  "Sullivan", "Bell", "Coleman", "Butler", "Henderson", "Barnes", "Fisher", "Vasquez",
  "Simmons", "Romero", "Jordan", "Patterson", "Alexander", "Hamilton", "Graham", "Reynolds",
  "Griffin", "Wallace", "Moreno", "West", "Cole", "Hayes", "Bryant", "Herrera",
  "Gibson", "Ellis", "Tran", "Medina", "Aguilar", "Stevens", "Murray", "Ford",
  "Castro", "Marshall", "Owens", "Harrison", "Fernandez", "McDonald", "Woods", "Washington",
  "Kennedy", "Wells", "Vargas", "Henry", "Chen", "Freeman", "Webb", "Tucker",
  "Burns", "Crawford", "Olson", "Carroll", "Duncan", "Snyder", "Hart", "Cunningham",
  "Bradley", "Lane", "Andrews", "Riley", "Carpenter", "Weaver", "Greene", "Lawrence",
  "Elliott", "Sims", "Peters", "Franklin", "Carlson", "Burke", "Lynch", "Fox",
  "Warren", "Keller", "Lowe", "Dean", "Holland", "Banks", "Bishop", "Grant",
  "Harvey", "Douglas", "Chapman", "Schmidt", "Wagner", "Meyer", "Hoffman", "Zimmerman",
  "Klein", "Wolf", "Schroeder", "Becker", "Schulz", "Richter", "Koch", "Bauer",
];

/** Compact blocks injected into onboarding prompts. */
export function formatNameListsForPrompt() {
  return (
    "Approved first names (pick exactly one unless the user gave a first name in their answers):\n" +
    FIRST_NAMES.join(", ") +
    "\n\nApproved last names (pick exactly one unless the user gave a surname in their answers):\n" +
    LAST_NAMES.join(", ")
  );
}
