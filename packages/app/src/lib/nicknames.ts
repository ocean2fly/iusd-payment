/**
 * Nickname word pools — 200 positive/neutral adjectives + 200 positive/neutral nouns.
 * Used by both API (registration) and frontend (nickname editor).
 */

export const ADJECTIVES = [
  // Original
  'happy','swift','clever','bright','brave','calm','cool','eager','fair','gentle',
  'kind','lucky','neat','proud','quick','sharp','smart','warm','wise','bold',
  // Nature / Weather
  'sunny','breezy','misty','dewy','frosty','golden','silver','crystal','coral','amber',
  'azure','jade','ivory','pearl','ruby','opal','topaz','cobalt','bronze','copper',
  // Personality
  'cheerful','lively','merry','jolly','witty','agile','nimble','steady','loyal','noble',
  'honest','humble','patient','polite','sincere','tender','caring','daring','fearless','valiant',
  // Energy / Motion
  'dynamic','vibrant','radiant','stellar','cosmic','lunar','solar','electric','magnetic','sonic',
  'turbo','hyper','mega','ultra','super','epic','mighty','grand','vast','prime',
  // Texture / Feel
  'smooth','silky','velvet','crisp','fresh','clean','pure','light','airy','fluffy',
  'cozy','snug','plush','soft','sleek','glossy','polished','refined','elegant','graceful',
  // Character
  'playful','curious','creative','inventive','artistic','dreamy','mystic','serene','tranquil','peaceful',
  'joyful','blissful','spirited','peppy','perky','zesty','spicy','tangy','fizzy','bubbly',
  // Strength
  'sturdy','solid','tough','hardy','robust','resilient','enduring','lasting','firm','stable',
  'strong','powerful','fierce','intense','vivid','striking','dazzling','gleaming','shining','glowing',
  // Speed / Agility
  'rapid','speedy','hasty','fleet','brisk','zippy','snappy','deft','adept','keen',
  'alert','aware','active','mobile','ready','prompt','instant','express','direct','focused',
  // Mood
  'chill','relaxed','mellow','zen','groovy','funky','jazzy','rhythmic','harmonic','melodic',
  'lyrical','poetic','scenic','vivid','lucid','clear','open','free','wild','roaming',
  // Modern / Tech
  'digital','cyber','pixel','quantum','atomic','photon','neon','laser','binary','crypto',
  'neural','stellar','orbital','astral','prism','nova','apex','zenith','summit','peak',
]

export const NOUNS = [
  // Animals — Land
  'panda','tiger','eagle','dolphin','wolf','fox','bear','hawk','lion','owl',
  'raven','falcon','jaguar','lynx','otter','badger','gecko','mantis','coyote','ferret',
  'deer','elk','bison','gazelle','cheetah','panther','leopard','mustang','stallion','pony',
  'rabbit','squirrel','hedgehog','beaver','raccoon','koala','lemur','meerkat','armadillo','alpaca',
  // Animals — Sky
  'robin','finch','sparrow','heron','crane','swan','pelican','parrot','toucan','flamingo',
  'condor','osprey','kite','lark','wren','dove','jay','oriole','cardinal','magpie',
  // Animals — Sea
  'whale','shark','seal','walrus','penguin','narwhal','octopus','jellyfish','starfish','coral',
  'turtle','marlin','sailfish','manta','barracuda','clownfish','seahorse','lobster','crab','shrimp',
  // Mythical
  'dragon','phoenix','griffin','unicorn','pegasus','sphinx','titan','atlas','orion','apollo',
  'mercury','venus','neptune','pluto','aurora','luna','nova','cosmos','nebula','quasar',
  // Nature — Plants
  'oak','maple','cedar','pine','birch','willow','bamboo','lotus','orchid','iris',
  'dahlia','jasmine','violet','lily','rose','tulip','daisy','fern','moss','sage',
  // Nature — Elements
  'river','brook','creek','spring','lake','ocean','wave','tide','reef','shore',
  'cliff','ridge','canyon','valley','meadow','grove','forest','summit','peak','glacier',
  // Objects / Symbols
  'prism','crystal','diamond','gem','jewel','crown','shield','arrow','compass','anchor',
  'lantern','beacon','torch','spark','ember','flame','blaze','comet','meteor','star',
  // Tech / Modern
  'pixel','circuit','signal','pulse','cipher','vector','matrix','nexus','vertex','helix',
  'photon','proton','neutron','qubit','voxel','radar','sonar','laser','drone','rover',
]
