import tseslint from 'typescript-eslint';
import obsidian from 'eslint-plugin-obsidianmd';

export default [{
  files:['src/**/*.ts'],
  languageOptions:{parser:tseslint.parser,parserOptions:{projectService:true,tsconfigRootDir:import.meta.dirname}},
  plugins:{'@typescript-eslint':tseslint.plugin,obsidianmd:obsidian},
  rules:{
    'obsidianmd/no-static-styles-assignment':'error',
    'obsidianmd/prefer-create-el':'error',
    'obsidianmd/prefer-window-timers':'error',
    '@typescript-eslint/no-unsafe-argument':'error',
    '@typescript-eslint/no-unsafe-member-access':'error',
    '@typescript-eslint/no-unsafe-assignment':'error',
    '@typescript-eslint/no-unsafe-return':'error',
    '@typescript-eslint/no-unnecessary-type-assertion':'error',
    '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrorsIgnorePattern:'^_'}],
    '@typescript-eslint/no-deprecated':'error',
    'no-control-regex':'error',
    'no-useless-escape':'error',
    'no-empty':'error'
  }
}];
