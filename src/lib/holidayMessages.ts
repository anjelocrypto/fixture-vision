/**
 * Holiday-aware empty state messages for a friendlier UX
 */

export interface HolidayMessage {
  title: string;
  description: string;
  icon: string;
}

export const getEmptyStateMessage = (date: Date, lang: 'en' | 'ka' = 'en'): HolidayMessage => {
  const day = date.getDate();
  const month = date.getMonth() + 1; // 0-indexed

  // Christmas Eve (Dec 24)
  if (month === 12 && day === 24) {
    return lang === 'ka' 
      ? {
          title: "⚽ მატჩები ხვალიდან განახლდება!",
          description: "შობის წინა დღეა – ლიგების უმეტესობა პაუზაზეა. ბოქსინგ დეის მატჩები მალე!",
          icon: "🎄"
        }
      : {
          title: "⚽ Matches Resume Tomorrow!",
          description: "It's Christmas Eve – most leagues are taking a break. Boxing Day fixtures coming soon!",
          icon: "🎄"
        };
  }

  // Christmas Day (Dec 25)
  if (month === 12 && day === 25) {
    return lang === 'ka'
      ? {
          title: "🎄 გილოცავთ შობას!",
          description: "დღეს შეზღუდული მატჩებია. ბოქსინგ დეი მოაქვს აქტიურ თამაშებს!",
          icon: "🎅"
        }
      : {
          title: "🎄 Merry Christmas!",
          description: "Limited matches today. Boxing Day brings the action back!",
          icon: "🎅"
        };
  }

  // New Year's Eve (Dec 31)
  if (month === 12 && day === 31) {
    return lang === 'ka'
      ? {
          title: "🎆 ახალი წელი მოდის!",
          description: "შეზღუდული მატჩები დღეს. ახალი წლის მატჩები მალე!",
          icon: "🥂"
        }
      : {
          title: "🎆 Happy New Year's Eve!",
          description: "Limited matches today. New Year fixtures coming soon!",
          icon: "🥂"
        };
  }

  // New Year's Day (Jan 1)
  if (month === 1 && day === 1) {
    return lang === 'ka'
      ? {
          title: "🎉 გილოცავთ ახალ წელს!",
          description: "შეზღუდული მატჩები დღეს. რეგულარული ლიგები მალე განახლდება.",
          icon: "🎊"
        }
      : {
          title: "🎉 Happy New Year!",
          description: "Limited matches today. Regular league action resumes soon!",
          icon: "🎊"
        };
  }

  // Default message
  return lang === 'ka'
    ? {
        title: "📅 მატჩები არ არის დაგეგმილი",
        description: "არჩეული თარიღისთვის მატჩები არ არის. სცადეთ ხვალ!",
        icon: "📅"
      }
    : {
        title: "📅 No Matches Scheduled",
        description: "No fixtures available for the selected date. Try tomorrow!",
        icon: "📅"
      };
};
