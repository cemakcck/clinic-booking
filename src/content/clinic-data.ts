// Fictional clinic content. Every name and detail is invented for the demo. No prices anywhere.
export type WeeklyHours = { weekday: number; start: string; end: string };

export type DentistData = {
  slug: string;
  name: string;
  titleEn: string;
  titleTr: string;
  bioEn: string;
  bioTr: string;
  sortOrder: number;
  treatments: string[];
  hours: WeeklyHours[];
};

export type TreatmentData = {
  slug: string;
  durationMin: number;
  nameEn: string;
  nameTr: string;
  descEn: string;
  descTr: string;
};

const days = (list: number[], start: string, end: string): WeeklyHours[] =>
  list.map((weekday) => ({ weekday, start, end }));

const dentists: DentistData[] = [
  {
    slug: "elif-aydin",
    name: "Dr. Elif Aydın",
    titleEn: "Lead dentist, restorative care",
    titleTr: "Başhekim, restoratif diş tedavisi",
    bioEn:
      "Elif leads the clinic and focuses on gentle, long-lasting fillings and root canal care. She is known for explaining every step before she starts.",
    bioTr:
      "Elif kliniğin başhekimi; hassas ve uzun ömürlü dolgular ile kanal tedavisine odaklanıyor. Başlamadan önce her adımı anlatmasıyla tanınıyor.",
    sortOrder: 1,
    treatments: ["checkup", "filling", "whitening", "rootcanal", "child-checkup"],
    hours: days([1, 2, 3, 4, 5, 6], "09:00", "18:00"),
  },
  {
    slug: "murat-kaya",
    name: "Dr. Murat Kaya",
    titleEn: "Implant and surgical dentistry",
    titleTr: "İmplant ve cerrahi diş hekimliği",
    bioEn:
      "Murat has placed implants for over twelve years and runs the clinic's surgery sessions. He sees patients on weekdays only.",
    bioTr:
      "Murat on iki yılı aşkın süredir implant uyguluyor ve kliniğin cerrahi seanslarını yürütüyor. Yalnızca hafta içi hasta kabul ediyor.",
    sortOrder: 2,
    treatments: ["checkup", "filling", "implant-consult", "rootcanal"],
    hours: days([1, 2, 3, 4, 5], "09:00", "18:00"),
  },
  {
    slug: "selin-demir",
    name: "Dr. Selin Demir",
    titleEn: "Family and orthodontic dentistry",
    titleTr: "Aile ve ortodonti diş hekimliği",
    bioEn:
      "Selin looks after children and adults alike and plans clear aligner treatments. Her friendly manner puts nervous little patients at ease.",
    bioTr:
      "Selin çocuk ve yetişkin hastalara bakıyor, şeffaf plak tedavilerini planlıyor. Güler yüzü, çekingen küçük hastaları rahatlatıyor.",
    sortOrder: 3,
    treatments: ["checkup", "child-checkup", "aligner-consult", "whitening", "filling"],
    hours: [...days([1, 2, 3, 4, 5], "10:00", "16:00"), ...days([6], "10:00", "14:00")],
  },
  {
    slug: "can-ozturk",
    name: "Dr. Can Öztürk",
    titleEn: "Cosmetic and implant dentistry",
    titleTr: "Estetik ve implant diş hekimliği",
    bioEn:
      "Can works on smile design, whitening and aligner planning, and also assists with implant cases. He is in the clinic Tuesday to Saturday.",
    bioTr:
      "Can gülüş tasarımı, diş beyazlatma ve şeffaf plak planlamasıyla ilgileniyor, implant vakalarında da görev alıyor. Salıdan cumartesiye klinikte.",
    sortOrder: 4,
    treatments: ["checkup", "implant-consult", "aligner-consult", "filling", "whitening"],
    hours: days([2, 3, 4, 5, 6], "09:00", "18:00"),
  },
];

const treatments: TreatmentData[] = [
  {
    slug: "checkup",
    durationMin: 30,
    nameEn: "Check-up and cleaning",
    nameTr: "Muayene ve temizlik",
    descEn: "A full examination and a professional clean, with advice for your daily routine.",
    descTr: "Tam bir ağız muayenesi ve profesyonel diş temizliği; günlük bakım için öneriler.",
  },
  {
    slug: "filling",
    durationMin: 45,
    nameEn: "Filling",
    nameTr: "Dolgu",
    descEn: "Tooth-coloured fillings to repair cavities and chips, placed with local anaesthetic.",
    descTr: "Çürük ve kırıkları onaran, lokal anestezi ile yapılan diş renginde dolgular.",
  },
  {
    slug: "whitening",
    durationMin: 60,
    nameEn: "Teeth whitening",
    nameTr: "Diş beyazlatma",
    descEn: "In-clinic whitening for a brighter smile, after a quick check of your gums and enamel.",
    descTr: "Diş eti ve minenin kısa bir kontrolünün ardından, klinikte yapılan beyazlatma.",
  },
  {
    slug: "implant-consult",
    durationMin: 45,
    nameEn: "Implant consultation",
    nameTr: "İmplant danışmanlığı",
    descEn: "We review your X-rays, talk through the options and outline a treatment plan.",
    descTr: "Röntgenlerinizi inceliyor, seçenekleri konuşuyor ve bir tedavi planı çıkarıyoruz.",
  },
  {
    slug: "aligner-consult",
    durationMin: 45,
    nameEn: "Clear aligner consultation",
    nameTr: "Şeffaf plak danışmanlığı",
    descEn: "Digital scan and a first look at how clear aligners could straighten your teeth.",
    descTr: "Dijital tarama ve şeffaf plakların dişlerinizi nasıl düzeltebileceğine ilk bakış.",
  },
  {
    slug: "rootcanal",
    durationMin: 90,
    nameEn: "Root canal treatment",
    nameTr: "Kanal tedavisi",
    descEn: "Pain-free treatment of an infected tooth nerve, so you can keep your natural tooth.",
    descTr: "Doğal dişinizi koruyabilmeniz için enfekte diş siniri tedavisi, ağrısız şekilde.",
  },
  {
    slug: "child-checkup",
    durationMin: 30,
    nameEn: "Children's check-up",
    nameTr: "Çocuk muayenesi",
    descEn: "A calm, playful first visit or routine check for children up to twelve.",
    descTr: "On iki yaşına kadar çocuklar için sakin ve eğlenceli ilk ziyaret ya da rutin kontrol.",
  },
];

const clinicHours: { weekday: number; open: string | null; close: string | null }[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, open: "09:00", close: "18:00" })),
  { weekday: 6, open: "10:00", close: "14:00" },
  { weekday: 0, open: null, close: null },
];

// [name, locale]. Emails are derived from the name and always end in @example.com.
const patientNames: [string, "en" | "tr"][] = [
  ["Ayşe Yılmaz", "tr"], ["Mehmet Şahin", "tr"], ["Zeynep Çelik", "tr"], ["Burak Arslan", "tr"],
  ["Elçin Koç", "tr"], ["Emre Doğan", "tr"], ["Gizem Aksoy", "tr"], ["Oğuz Polat", "tr"],
  ["Defne Güneş", "tr"], ["Kerem Yıldız", "tr"], ["Naz Erdem", "tr"], ["Tolga Aslan", "tr"],
  ["İpek Kurt", "tr"], ["Barış Özdemir", "tr"], ["Selma Tunç", "tr"], ["Ozan Korkmaz", "tr"],
  ["Merve Bulut", "tr"], ["Cem Karaca", "tr"], ["Ece Taş", "tr"], ["Hakan Işık", "tr"],
  ["Sarah Mitchell", "en"], ["Daniel Brooks", "en"], ["Anna Kowalski", "en"], ["Lucas Moreau", "en"],
  ["Priya Nair", "en"], ["James Walker", "en"], ["Marta Rossi", "en"], ["Jonas Berg", "en"],
  ["Olivia Hart", "en"], ["Tariq Hassan", "en"],
];

const fold = (s: string) =>
  s
    .replace(/ı/g, "i").replace(/İ/g, "i")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z]+/g, ".");

const patients = patientNames.map(([name, locale], i) => ({
  name,
  locale,
  // 555 range, clearly fictional; normalizes to +90532555 01NN
  phone: `0532 555 01 ${String(i + 10)}`,
  email: `${fold(name)}@example.com`,
}));

export const clinicData = {
  clinicHours,
  lunch: { start: "12:30", end: "13:30" },
  dentists,
  treatments,
  patients,
};
