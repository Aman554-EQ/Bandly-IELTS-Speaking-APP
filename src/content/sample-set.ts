import type { ExamContent } from "@/engine/types";

/**
 * Sample question set used until the database exists (plan-2 Phase 1).
 *
 * Part 1 "Walking", the Part 2 cue card and the Part 3 questions are the set
 * supplied by the project owner. The core Part 1 frame (work or studies),
 * rephrasings, follow-up probes and round-off questions were added so the
 * examiner can behave like the real test.
 */
export const SAMPLE_SET: ExamContent = {
  part1: [
    {
      id: "work-study",
      title: "Work or studies",
      isCore: true,
      intro: "First, let's talk about what you do.",
      questions: [
        { id: "work-study-1", text: "Do you work, or are you a student?" },
        { id: "work-study-2", text: "What do you enjoy most about your work or your studies?" },
        {
          id: "work-study-3",
          text: "Is there anything you would like to change about your work or your studies?",
          allowWhyProbe: true,
        },
      ],
    },
    {
      id: "walking",
      title: "Walking",
      intro: "Now, let's talk about walking.",
      questions: [
        { id: "walking-1", text: "How much walking do you do in your daily life?" },
        {
          id: "walking-2",
          text: "Did you walk more when you were at school than now?",
          allowWhyProbe: true,
        },
        { id: "walking-3", text: "What places are there to go for a walk near where you live?" },
        {
          id: "walking-4",
          text: "Would you ever like to go on a walking holiday?",
          allowWhyProbe: true,
        },
      ],
    },
  ],
  cueCard: {
    id: "film-again",
    prompt: "Describe a play or a film you have seen that you would like to see again with friends.",
    bullets: [
      "what play or film you'd like to go to see again",
      "who you would go with",
      "what other people have said about this play or film",
    ],
    explain: "and explain why you would like to see this play or film again with friends.",
    spokenPrompt:
      "I'd like you to describe a play or a film you have seen that you would like to see again with friends.",
    roundOff: [
      { id: "film-again-r1", text: "Do you usually go to see plays or films with friends?" },
      { id: "film-again-r2", text: "Do your friends have similar tastes to you?" },
    ],
    part3Intro:
      "We've been talking about a play or a film you would like to see again, and I'd like to discuss with you one or two more general questions related to this.",
    part3OnlyIntro: "I'd like to discuss with you some general questions related to theatre and acting.",
    part3: [
      {
        id: "theatre-culture",
        title: "Theatre culture",
        intro: "Let's consider first of all theatre culture.",
        questions: [
          {
            id: "theatre-1",
            text: "What are the most popular kinds of plays or shows at theatres in your country?",
            rephrase: "What sorts of shows do people in your country most like to see at the theatre?",
            followUps: ["Why do you think those are so popular?"],
          },
          {
            id: "theatre-2",
            text: "How easy is it to get tickets to the theatre?",
            rephrase: "Is it easy or difficult for people to buy theatre tickets where you live?",
            followUps: ["Why do you think that is?"],
          },
          {
            id: "theatre-3",
            text: "Do you think theatres need to do more to attract younger audiences?",
            rephrase: "Should theatres try harder to get young people to come to their shows?",
            followUps: ["What could they do?"],
          },
        ],
      },
      {
        id: "being-an-actor",
        title: "Being an actor",
        intro: "Now let's talk about being an actor.",
        questions: [
          {
            id: "actor-1",
            text: "What do you think attracts people to working as an actor?",
            rephrase: "Why do you think some people want to become actors?",
            followUps: ["Can you give me an example?"],
          },
          {
            id: "actor-2",
            text: "What are some of the qualities that a person needs to have if they want to become an actor?",
            rephrase: "What kind of personality or skills does someone need to be a good actor?",
            followUps: ["Why is that important?"],
          },
          {
            id: "actor-3",
            text: "Can you think of any disadvantages of working as an actor?",
            rephrase: "What are some of the difficulties of an acting career?",
            followUps: ["Do you think those difficulties are worth it?"],
          },
        ],
      },
    ],
  },
};
