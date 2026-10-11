import {describe,it,expect,vi} from 'vitest';
import Button from '../../components/Button';
import {modalTabTarget} from './modalFocus';
import type {MouseEvent} from 'react';
describe('shared interaction regressions',()=>{
 it('loading keeps focusable button but blocks repeated pointer and keyboard click activation',()=>{const click=vi.fn(),preventDefault=vi.fn(),stopPropagation=vi.fn();const element=Button({loading:true,onClick:click,children:'Save'});expect(element.props.disabled).toBeUndefined();expect(element.props['aria-busy']).toBe(true);element.props.onClick({preventDefault,stopPropagation} as unknown as MouseEvent<HTMLButtonElement>);expect(click).not.toHaveBeenCalled();expect(preventDefault).toHaveBeenCalled();});
 it('normal button still invokes original action',()=>{const click=vi.fn();Button({onClick:click}).props.onClick({} as MouseEvent<HTMLButtonElement>);expect(click).toHaveBeenCalledOnce();});
 it('contains forward and reverse Tab without interfering with interior fields',()=>{const panel={},first={},middle={},last={};expect(modalTabTarget([first,middle,last],last,panel,false)).toBe(first);expect(modalTabTarget([first,middle,last],first,panel,true)).toBe(last);expect(modalTabTarget([first,middle,last],middle,panel,false)).toBeNull();expect(modalTabTarget([],panel,panel,true)).toBe(panel);});
});
